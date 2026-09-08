/**
 * Tests for the Jest adapter.
 *
 * Includes pure-parser unit tests and an integration test that runs the real
 * `jest` against the `node-ts-jest` fixture.
 */

import * as path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

import { JestAdapter, parseJestJsonOutput } from "../src/JestAdapter.js";
import { ProcessRunner } from "@nodeforge/runner";
import type { TestSuite } from "@nodeforge/contracts";

const FIXTURE = path.resolve(__dirname, "../../../test-fixtures/node-ts-jest");

describe("parseJestJsonOutput (pure parser)", () => {
  it("parses a single passing test with no describe block", () => {
    const json = JSON.stringify({
      numTotalTests: 1,
      numPassedTests: 1,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
      success: true,
      testResults: [
        {
          name: "/workspace/foo.test.ts",
          status: "passed",
          assertionResults: [
            {
              ancestorTitles: [],
              fullName: "adds two numbers",
              title: "adds two numbers",
              status: "passed",
              duration: 5
            }
          ]
        }
      ]
    });

    const { suite, summary } = parseJestJsonOutput(json, "/workspace");
    expect(summary.numTotalTests).toBe(1);
    expect(summary.numPassedTests).toBe(1);

    expect(suite.suites).toHaveLength(1);
    const fileSuite = suite.suites[0]!;
    expect(fileSuite.tests).toHaveLength(1);
    expect(fileSuite.tests[0]!.name).toBe("adds two numbers");
    expect(fileSuite.tests[0]!.durationMs).toBe(5);
  });

  it("uses ancestorTitles to build nested describe suites", () => {
    const json = JSON.stringify({
      numTotalTests: 2,
      numPassedTests: 2,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
      success: true,
      testResults: [
        {
          name: "/workspace/foo.test.ts",
          status: "passed",
          assertionResults: [
            {
              ancestorTitles: ["describe block"],
              fullName: "describe block test one",
              title: "test one",
              status: "passed"
            },
            {
              ancestorTitles: ["describe block"],
              fullName: "describe block test two",
              title: "test two",
              status: "passed"
            }
          ]
        }
      ]
    });

    const { suite } = parseJestJsonOutput(json, "/workspace");
    const fileSuite = suite.suites[0]!;
    expect(fileSuite.suites).toHaveLength(1);
    expect(fileSuite.suites[0]!.name).toBe("describe block");
    expect(fileSuite.suites[0]!.tests).toHaveLength(2);
  });

  it("supports nested describe blocks (two-level ancestor chain)", () => {
    const json = JSON.stringify({
      numTotalTests: 1,
      numPassedTests: 1,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
      success: true,
      testResults: [
        {
          name: "/workspace/foo.test.ts",
          status: "passed",
          assertionResults: [
            {
              ancestorTitles: ["outer", "inner"],
              fullName: "outer inner test one",
              title: "test one",
              status: "passed"
            }
          ]
        }
      ]
    });

    const { suite } = parseJestJsonOutput(json, "/workspace");
    const fileSuite = suite.suites[0]!;
    expect(fileSuite.suites).toHaveLength(1); // outer
    const outer = fileSuite.suites[0]!;
    expect(outer.name).toBe("outer");
    expect(outer.suites).toHaveLength(1); // inner
    expect(outer.suites[0]!.name).toBe("inner");
    expect(outer.suites[0]!.tests).toHaveLength(1);
  });

  it("captures failure messages", () => {
    const json = JSON.stringify({
      numTotalTests: 1,
      numPassedTests: 0,
      numFailedTests: 1,
      numPendingTests: 0,
      numTodoTests: 0,
      success: false,
      testResults: [
        {
          name: "/workspace/foo.test.ts",
          status: "failed",
          assertionResults: [
            {
              ancestorTitles: [],
              fullName: "failing test",
              title: "failing test",
              status: "failed",
              failureMessages: ["Expected 2 to be 3."]
            }
          ]
        }
      ]
    });

    const { suite } = parseJestJsonOutput(json, "/workspace");
    const test = suite.suites[0]!.tests[0]!;
    expect(test.status).toBe("failed");
    expect(test.error).toBeDefined();
    expect(test.error!.message).toBe("Expected 2 to be 3.");
  });

  it("returns empty suite for empty stdout", () => {
    const { suite, summary } = parseJestJsonOutput("", "/workspace");
    expect(suite.suites).toHaveLength(0);
    expect(summary.numTotalTests).toBe(0);
  });

  it("throws AdapterParseError on malformed JSON", () => {
    expect(() => parseJestJsonOutput("not valid json", "/workspace")).toThrow(/Failed to parse JSON/);
  });
});

describe("JestAdapter (integration against fixture)", () => {
  it("resolves local jest and reports real test results", async () => {
    const jestBin = path.join(FIXTURE, "node_modules", ".bin", "jest");
    try {
      await fs.access(jestBin);
    } catch {
      console.warn(`[nodeforge:test] skipping Jest integration test — fixture jest missing at ${jestBin}`);
      return;
    }

    const runner = new ProcessRunner();
    const adapter = new JestAdapter(runner, { jestPath: jestBin });
    const result = await adapter.run(FIXTURE);

    // Jest exits 1 when any test fails.
    expect(result.exitCode).toBe(1);
    expect(result.result.counts.passed).toBe(5);
    expect(result.result.counts.failed).toBe(1);
    expect(result.result.status).toBe("failed");

    // The fixture has one test file → one file-level suite.
    expect(result.suite.suites).toHaveLength(1);
    const fileSuite = result.suite.suites[0]!;
    expect(fileSuite.name).toContain("math.test.ts");

    // Jest should produce nested describe suites via ancestorTitles.
    expect(fileSuite.suites.length).toBeGreaterThanOrEqual(2);
    const describeNames = fileSuite.suites.map((s) => s.name).sort();
    expect(describeNames).toEqual(expect.arrayContaining(["add", "divide"]));

    // Total test count: 5 passing + 1 failing = 6.
    const allTests = collectAllTests(fileSuite);
    expect(allTests.length).toBe(6);

    const failed = allTests.filter((t) => t.status === "failed");
    expect(failed.length).toBe(1);
    expect(failed[0]!.name).toBe("intentionally failing assertion");
  });

  it("detects jest config via hasConfig static method", async () => {
    expect(await JestAdapter.hasConfig(FIXTURE)).toBe(true);
    expect(await JestAdapter.hasConfig(path.dirname(FIXTURE))).toBe(false);
  });
});

/** Recursively collect every TestCase under a TestSuite. */
function collectAllTests(suite: TestSuite): TestSuite["tests"] {
  const out = [...suite.tests];
  for (const child of suite.suites) {
    out.push(...collectAllTests(child));
  }
  return out;
}
