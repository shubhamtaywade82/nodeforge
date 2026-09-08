/**
 * Integration tests for the ESLint adapter.
 *
 * Runs the real `eslint` against the `node-ts-with-errors` fixture and asserts
 * that the adapter correctly parses JSON output into normalized diagnostics.
 */

import * as path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

import { EslintAdapter, parseEslintJsonOutput } from "../src/EslintAdapter.js";
import { ProcessRunner } from "@nodeforge/runner";

const FIXTURE = path.resolve(__dirname, "../../../test-fixtures/node-ts-with-errors");

describe("parseEslintJsonOutput (pure parser)", () => {
  it("parses a single error message", () => {
    const json = JSON.stringify([
      {
        filePath: "/workspace/src/foo.ts",
        messages: [
          {
            ruleId: "no-undef",
            severity: 2,
            message: "'x' is not defined.",
            line: 10,
            column: 5,
            endLine: 10,
            endColumn: 6
          }
        ],
        errorCount: 1,
        fatalErrorCount: 0,
        warningCount: 0,
        fixableErrorCount: 0,
        fixableWarningCount: 0,
        suppressedMessages: []
      }
    ]);

    const diags = parseEslintJsonOutput(json, "/workspace");
    expect(diags).toHaveLength(1);
    const d = diags[0]!;
    expect(d.source).toBe("eslint");
    expect(d.severity).toBe("error");
    expect(d.rule).toBe("no-undef");
    expect(d.code).toBe("no-undef");
    expect(d.message).toBe("'x' is not defined.");
    expect(d.file).toBe(path.resolve("/workspace", "/workspace/src/foo.ts"));
    expect(d.range.line).toBe(10);
    expect(d.range.column).toBe(5);
    expect(d.range.endLine).toBe(10);
    expect(d.range.endColumn).toBe(6);
    expect(d.fixable).toBe(false);
  });

  it("maps severity 1 to warning and 2 to error", () => {
    const json = JSON.stringify([
      {
        filePath: "/workspace/a.ts",
        messages: [
          { ruleId: "r1", severity: 1, message: "w", line: 1, column: 1 },
          { ruleId: "r2", severity: 2, message: "e", line: 2, column: 2 }
        ],
        errorCount: 1,
        fatalErrorCount: 0,
        warningCount: 1,
        fixableErrorCount: 0,
        fixableWarningCount: 0,
        suppressedMessages: []
      }
    ]);

    const diags = parseEslintJsonOutput(json, "/workspace");
    expect(diags).toHaveLength(2);
    expect(diags[0]!.severity).toBe("warning");
    expect(diags[1]!.severity).toBe("error");
  });

  it("marks diagnostics with a fix as fixable", () => {
    const json = JSON.stringify([
      {
        filePath: "/workspace/a.ts",
        messages: [
          {
            ruleId: "semi",
            severity: 2,
            message: "Missing semicolon.",
            line: 1,
            column: 5,
            fix: { range: [4, 4], text: ";" }
          }
        ],
        errorCount: 1,
        fatalErrorCount: 0,
        warningCount: 0,
        fixableErrorCount: 1,
        fixableWarningCount: 0,
        suppressedMessages: []
      }
    ]);

    const diags = parseEslintJsonOutput(json, "/workspace");
    expect(diags[0]!.fixable).toBe(true);
  });

  it("handles files with no messages", () => {
    const json = JSON.stringify([
      {
        filePath: "/workspace/clean.ts",
        messages: [],
        suppressedMessages: [],
        errorCount: 0,
        fatalErrorCount: 0,
        warningCount: 0,
        fixableErrorCount: 0,
        fixableWarningCount: 0
      }
    ]);

    const diags = parseEslintJsonOutput(json, "/workspace");
    expect(diags).toHaveLength(0);
  });

  it("throws AdapterParseError on malformed JSON", () => {
    expect(() => parseEslintJsonOutput("not valid json", "/workspace")).toThrow(/Failed to parse JSON/);
  });
});

describe("EslintAdapter (integration against fixture)", () => {
  it("resolves local eslint and reports real diagnostics", async () => {
    const eslintBin = path.join(FIXTURE, "node_modules", ".bin", "eslint");
    try {
      await fs.access(eslintBin);
    } catch {
      console.warn(`[nodeforge:test] skipping ESLint integration test — fixture eslint missing at ${eslintBin}`);
      return;
    }

    const runner = new ProcessRunner();
    const adapter = new EslintAdapter(runner, { eslintPath: eslintBin });
    const result = await adapter.run(FIXTURE);

    // ESLint 9 exits 0 if no errors (warnings alone don't trigger exit 1 unless
    // --max-warnings=0 is set). Our fixture has 2 warnings, 0 errors → exit 0.
    expect(result.exitCode).toBe(0);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(2);

    // We expect @typescript-eslint/no-unused-vars findings on broken.ts.
    const unusedVars = result.diagnostics.filter(
      (d) => d.rule === "@typescript-eslint/no-unused-vars"
    );
    expect(unusedVars.length).toBeGreaterThanOrEqual(2);

    // All diagnostics should reference broken.ts with absolute paths.
    for (const d of result.diagnostics) {
      expect(path.isAbsolute(d.file)).toBe(true);
      expect(d.file).toContain("broken.ts");
      expect(d.source).toBe("eslint");
      expect(d.severity).toBe("warning"); // our config sets no-unused-vars to "warn"
      expect(d.range.line).toBeGreaterThan(0);
      expect(d.range.column).toBeGreaterThan(0);
    }
  });

  it("detects eslint config presence via hasConfig static method", async () => {
    expect(await EslintAdapter.hasConfig(FIXTURE)).toBe(true);
    expect(await EslintAdapter.hasConfig(path.dirname(FIXTURE))).toBe(false);
  });
});
