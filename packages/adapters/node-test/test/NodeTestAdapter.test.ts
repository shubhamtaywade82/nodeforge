import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { ProcessRunner } from "@nodeforge/runner";
import { NodeTestAdapter, parseNodeTestOutput } from "../src/NodeTestAdapter.js";

const FIXTURE = path.resolve(__dirname, "../../../test-fixtures/node-ts-node-test");

describe("parseNodeTestOutput", () => {
  it("normalizes pass, skip, and todo cases", () => {
    const raw = "__NODEFORGE_NODE_TEST_RESULT__" + JSON.stringify({
      cases: [
        { testId: 1, name: "passes", file: "test/math.test.js", line: 3, passed: true },
        { testId: 2, name: "skips", file: "test/math.test.js", line: 7, passed: true, skip: "not on CI" },
        { testId: 3, name: "todo", file: "test/math.test.js", line: 11, passed: false, todo: true }
      ]
    });

    const { result } = parseNodeTestOutput(raw, FIXTURE);

    expect(result.counts.passed).toBe(1);
    expect(result.counts.skipped).toBe(1);
    expect(result.counts.todo).toBe(1);
    expect(result.failures).toHaveLength(0);
  });

  it("normalizes failures with location metadata", () => {
    const raw = "__NODEFORGE_NODE_TEST_RESULT__" + JSON.stringify({
      cases: [{
        testId: 7,
        name: "fails",
        file: "test/math.test.js",
        line: 15,
        column: 4,
        passed: false,
        error: { message: "expected 1 to equal 2", stack: "Error: expected 1 to equal 2" }
      }]
    });

    const { suite, result } = parseNodeTestOutput(raw, FIXTURE);

    expect(suite.tests[0]?.status).toBe("failed");
    expect(result.failures[0]?.location?.line).toBe(15);
    expect(result.failures[0]?.location?.column).toBe(4);
  });
});

describe("NodeTestAdapter", () => {
  it("runs the built-in Node test runner without fixture dependencies", async () => {
    const adapter = new NodeTestAdapter(new ProcessRunner());
    const result = await adapter.run(FIXTURE);

    expect(result.result.counts.passed).toBeGreaterThanOrEqual(2);
    expect(result.result.counts.skipped).toBe(1);
    expect(result.result.counts.todo).toBe(1);
    expect(result.suite.suites).toHaveLength(1);
    expect(result.suite.suites[0]?.tests).toHaveLength(4);
    expect(result.suite.suites[0]?.suites).toHaveLength(1);
    expect(result.suite.suites[0]?.suites[0]?.name).toBe("nested math");
    expect(result.suite.suites[0]?.suites[0]?.tests[0]?.name).toBe("multiplies numbers");
    expect(result.exitCode).toBe(0);
    expect(result.result.durationMs).toBe(result.durationMs);
    expect(result.result.stdout).toBe(result.rawStdout);
    expect(result.result.stderr).toBe(result.rawStderr);
  });

  it("runs a specific file without turning the file path into a test-name filter", async () => {
    const adapter = new NodeTestAdapter(new ProcessRunner());
    const file = path.join(FIXTURE, "test/math.test.js");
    const result = await adapter.run(FIXTURE, undefined, {
      id: "file:" + file,
      name: file,
      file,
      status: "running"
    });

    expect(result.result.counts.passed).toBeGreaterThanOrEqual(3);
    expect(result.result.counts.skipped).toBe(1);
    expect(result.result.counts.todo).toBe(1);
    expect(result.result.stdout).toBe(result.rawStdout);
    expect(result.result.stderr).toBe(result.rawStderr);
    expect(result.result.durationMs).toBe(result.durationMs);
  });

  it("detects a package.json script using node --test", async () => {
    await expect(NodeTestAdapter.hasConfig(FIXTURE)).resolves.toBe(true);
  });
});
