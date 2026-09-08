/**
 * Integration tests for the TypeScript adapter.
 *
 * Runs the real `tsc` against the `node-ts-with-errors` fixture and asserts
 * that the adapter correctly parses compiler output into normalized diagnostics.
 */

import * as path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

import { TypescriptAdapter, parseTscOutput } from "../src/TypescriptAdapter.js";
import { ProcessRunner } from "@nodeforge/runner";

const FIXTURE = path.resolve(__dirname, "../../../test-fixtures/node-ts-with-errors");

describe("parseTscOutput (pure parser)", () => {
  it("parses a single error line", () => {
    const stdout = "src/broken.ts(21,14): error TS2304: Cannot find name 'undefinedVariable'.\n";
    const diags = parseTscOutput(stdout, "/workspace");

    expect(diags).toHaveLength(1);
    const d = diags[0]!;
    expect(d.source).toBe("typescript");
    expect(d.severity).toBe("error");
    expect(d.code).toBe("TS2304");
    expect(d.rule).toBe("TS2304");
    expect(d.message).toBe("Cannot find name 'undefinedVariable'.");
    expect(d.file).toBe(path.resolve("/workspace", "src/broken.ts"));
    expect(d.range.line).toBe(21);
    expect(d.range.column).toBe(14);
    expect(d.fixable).toBe(false);
    expect(d.id).toBe(`typescript:TS2304:${d.file}:21:14`);
  });

  it("parses warnings and errors", () => {
    const stdout = [
      "src/a.ts(1,1): error TS2304: Foo.",
      "src/b.ts(2,3): warning TS6133: 'x' is declared but never read.",
      ""
    ].join("\n");
    const diags = parseTscOutput(stdout, "/workspace");
    expect(diags).toHaveLength(2);
    expect(diags[0]!.severity).toBe("error");
    expect(diags[1]!.severity).toBe("warning");
  });

  it("ignores blank and summary lines", () => {
    const stdout = [
      "",
      "Found 3 errors. Watching for file changes.",
      "src/broken.ts(1,1): error TS9999: Bad.",
      ""
    ].join("\n");
    const diags = parseTscOutput(stdout, "/workspace");
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("TS9999");
  });

  it("handles info and hint severities", () => {
    const stdout = "src/x.ts(1,1): info TS80001: Some info.\nsrc/y.ts(2,2): hint TS80002: Some hint.\n";
    const diags = parseTscOutput(stdout, "/workspace");
    expect(diags).toHaveLength(2);
    expect(diags[0]!.severity).toBe("info");
    expect(diags[1]!.severity).toBe("hint");
  });
});

describe("TypescriptAdapter (integration against fixture)", () => {
  it("resolves the local tsc binary and reports real diagnostics", async () => {
    // The fixture has node_modules installed locally.
    const tscBin = path.join(FIXTURE, "node_modules", ".bin", "tsc");
    try {
      await fs.access(tscBin);
    } catch {
      // Skip integration test if fixture deps weren't installed.
      console.warn(`[nodeforge:test] skipping TS integration test — fixture tsc missing at ${tscBin}`);
      return;
    }

    const runner = new ProcessRunner();
    const adapter = new TypescriptAdapter(runner, { tscPath: tscBin });
    const result = await adapter.run(FIXTURE);

    expect(result.exitCode).toBe(2); // tsc exits 2 on type errors (TypeScript 5+)
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(4);

    // We expect TS2304 (Cannot find name 'undefinedVariable').
    const ts2304 = result.diagnostics.filter((d) => d.code === "TS2304");
    expect(ts2304.length).toBeGreaterThanOrEqual(1);
    expect(ts2304[0]!.message).toContain("undefinedVariable");

    // We expect TS2322 (Type 'string' is not assignable to type 'number').
    const ts2322 = result.diagnostics.filter((d) => d.code === "TS2322");
    expect(ts2322.length).toBeGreaterThanOrEqual(1);

    // All diagnostics should have absolute file paths.
    for (const d of result.diagnostics) {
      expect(path.isAbsolute(d.file)).toBe(true);
      expect(d.source).toBe("typescript");
      expect(d.range.line).toBeGreaterThan(0);
      expect(d.range.column).toBeGreaterThan(0);
      expect(d.fixable).toBe(false); // tsc doesn't expose fixability in CLI output
    }
  });

  it("supports cancellation via AbortSignal", async () => {
    const tscBin = path.join(FIXTURE, "node_modules", ".bin", "tsc");
    try {
      await fs.access(tscBin);
    } catch {
      console.warn("[nodeforge:test] skipping TS cancel test — fixture tsc missing");
      return;
    }

    const runner = new ProcessRunner();
    const adapter = new TypescriptAdapter(runner, { tscPath: tscBin });

    const controller = new AbortController();
    const promise = adapter.run(FIXTURE, controller.signal);
    setTimeout(() => controller.abort(), 5);

    await expect(promise).rejects.toThrow(/cancelled|timeout/i);
  });
});
