/**
 * Tests for the Vitest adapter.
 *
 * Includes pure-parser unit tests and an integration test that runs the real
 * `vitest` against the `node-ts-vitest` fixture.
 */

import * as path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

import { VitestAdapter, parseVitestJsonOutput } from "../src/VitestAdapter.js";
import { ProcessRunner } from "@nodeforge/runner";

const FIXTURE = path.resolve(__dirname, "../../../test-fixtures/node-ts-vitest");

describe("parseVitestJsonOutput (pure parser)", () => {
  it("parses a single passing test with no describe block", () => {
    const json = JSON.stringify({
      numTotalTests: 1,
      numPassedTests: 1,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
      testResults: [
        {
          name: "/workspace/foo.test.ts",
          status: "passed",
          assertionResults: [
            {
              // No describe block — fullName === title.
              fullName: "adds two numbers",
              title: "adds two numbers",
              status: "passed",
              duration: 5
            }
          ]
        }
      ]
    });

    const { suite, summary } = parseVitestJsonOutput(json, "/workspace");
    expect(summary.numTotalTests).toBe(1);
    expect(summary.numPassedTests).toBe(1);
    expect(summary.numFailedTests).toBe(0);

    expect(suite.suites).toHaveLength(1);
    const fileSuite = suite.suites[0]!;
    expect(fileSuite.name).toBe("foo.test.ts");
    expect(fileSuite.file).toBe(path.resolve("/workspace", "/workspace/foo.test.ts"));
    // Test outside any describe block goes to fileSuite.tests.
    expect(fileSuite.tests).toHaveLength(1);
    expect(fileSuite.tests[0]!.name).toBe("adds two numbers");
    expect(fileSuite.tests[0]!.status).toBe("passed");
    expect(fileSuite.tests[0]!.durationMs).toBe(5);
  });

  it("groups tests by describe block inferred from fullName", () => {
    const json = JSON.stringify({
      numTotalTests: 2,
      numPassedTests: 2,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
      testResults: [
        {
          name: "/workspace/foo.test.ts",
          status: "passed",
          assertionResults: [
            {
              fullName: "describe block test one",
              title: "test one",
              status: "passed"
            },
            {
              fullName: "describe block test two",
              title: "test two",
              status: "passed"
            }
          ]
        }
      ]
    });

    const { suite } = parseVitestJsonOutput(json, "/workspace");
    const fileSuite = suite.suites[0]!;
    expect(fileSuite.suites).toHaveLength(1);
    const describeSuite = fileSuite.suites[0]!;
    expect(describeSuite.name).toBe("describe block");
    expect(describeSuite.tests).toHaveLength(2);
    expect(describeSuite.tests[0]!.name).toBe("test one");
    expect(describeSuite.tests[1]!.name).toBe("test two");
  });

  it("captures failure messages", () => {
    const json = JSON.stringify({
      numTotalTests: 1,
      numPassedTests: 0,
      numFailedTests: 1,
      numPendingTests: 0,
      numTodoTests: 0,
      testResults: [
        {
          name: "/workspace/foo.test.ts",
          status: "failed",
          assertionResults: [
            {
              fullName: "failing test",
              title: "failing test",
              status: "failed",
              failureMessages: ["Expected 2 to be 3."]
            }
          ]
        }
      ]
    });

    const { suite } = parseVitestJsonOutput(json, "/workspace");
    const test = suite.suites[0]!.tests[0]!;
    expect(test.status).toBe("failed");
    expect(test.error).toBeDefined();
    expect(test.error!.message).toBe("Expected 2 to be 3.");
  });

  it("returns empty suite for empty stdout", () => {
    const { suite, summary } = parseVitestJsonOutput("", "/workspace");
    expect(suite.suites).toHaveLength(0);
    expect(suite.tests).toHaveLength(0);
    expect(summary.numTotalTests).toBe(0);
  });

  it("throws AdapterParseError on malformed JSON", () => {
    expect(() => parseVitestJsonOutput("not valid json", "/workspace")).toThrow(/Failed to parse JSON/);
  });
});

describe("VitestAdapter (integration against fixture)", () => {
  it("resolves local vitest and reports real test results", async () => {
    const vitestBin = path.join(FIXTURE, "node_modules", ".bin", "vitest");
    try {
      await fs.access(vitestBin);
    } catch {
      console.warn(`[nodeforge:test] skipping Vitest integration test — fixture vitest missing at ${vitestBin}`);
      return;
    }

    const runner = new ProcessRunner();
    const adapter = new VitestAdapter(runner, { vitestPath: vitestBin });
    const result = await adapter.run(FIXTURE);

    // Vitest exits 1 when any test fails.
    expect(result.exitCode).toBe(1);
    expect(result.result.counts.passed).toBe(5);
    expect(result.result.counts.failed).toBe(1);
    expect(result.result.status).toBe("failed");

    // The fixture has one test file → one file-level suite.
    expect(result.suite.suites).toHaveLength(1);
    const fileSuite = result.suite.suites[0]!;
    expect(fileSuite.name).toContain("math.test.ts");

    // Total test count: 5 passing + 1 failing = 6.
    const allTests = collectAllTests(fileSuite);
    expect(allTests.length).toBe(6);

    // At least one test should be marked as failed.
    const failed = allTests.filter((t) => t.status === "failed");
    expect(failed.length).toBe(1);
    expect(failed[0]!.name).toBe("intentionally failing assertion");
  });

  it("detects vitest config via hasConfig static method", async () => {
    expect(await VitestAdapter.hasConfig(FIXTURE)).toBe(true);
    expect(await VitestAdapter.hasConfig(path.dirname(FIXTURE))).toBe(false);
  });
});

/** Recursively collect every TestCase under a TestSuite. */
function collectAllTests(suite: { tests: unknown[]; suites: Array<{ tests: unknown[]; suites: unknown[] }> }): unknown[] {
  const out = [...suite.tests];
  for (const child of suite.suites) {
    out.push(...collectAllTests(child as never));
  }
  return out;
}
