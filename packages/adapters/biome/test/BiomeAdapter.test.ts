/**
 * Tests for the Biome adapter.
 *
 * Includes pure-parser unit tests (no real Biome needed) and integration
 * tests that run the real `biome` against the `node-ts-biome-lint` fixture.
 */

import * as path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BiomeAdapter,
  parseBiomeJsonOutput,
  stripAnsi,
  extractRuleName,
  spanToLineCol
} from "../src/BiomeAdapter.js";
import { ProcessRunner } from "@nodeforge/runner";

const FIXTURE = path.resolve(__dirname, "../../../test-fixtures/node-ts-biome-lint");

describe("stripAnsi", () => {
  it("removes ANSI color codes", () => {
    const input = "\x1b[0m\x1b[31m{\"foo\":1}\x1b[0m";
    expect(stripAnsi(input)).toBe("{\"foo\":1}");
  });

  it("leaves plain text untouched", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });
});

describe("extractRuleName", () => {
  it("extracts last segment of category", () => {
    expect(extractRuleName("lint/suspicious/noExplicitAny")).toBe("noExplicitAny");
    expect(extractRuleName("lint/style/useImportType")).toBe("useImportType");
    expect(extractRuleName("lint/a11y/useButtonType")).toBe("useButtonType");
  });

  it("returns category as-is for non-segmented categories", () => {
    expect(extractRuleName("format")).toBe("format");
  });
});

describe("spanToLineCol", () => {
  it("returns 1:1 for null span", () => {
    expect(spanToLineCol(null, "any source")).toEqual({ line: 1, column: 1 });
  });

  it("returns 1:1 for empty source", () => {
    expect(spanToLineCol([0, 5], "")).toEqual({ line: 1, column: 1 });
  });

  it("computes line and column for first-line offset", () => {
    const source = "hello world";
    expect(spanToLineCol([6, 11], source)).toEqual({ line: 1, column: 7 });
  });

  it("counts newlines for multi-line source", () => {
    const source = "line1\nline2\nline3";
    // offsets: 0='l', 1='i', 2='n', 3='e', 4='1', 5='\n',
    //          6='l', 7='i', 8='n', 9='e', 10='2', 11='\n',
    //          12='l', 13='i', 14='n', 15='e', 16='3'
    // offset 13 is 'i' in 'line3' → line 3, column 2
    expect(spanToLineCol([13, 14], source)).toEqual({ line: 3, column: 2 });
  });

  it("handles offset at first column of a line", () => {
    const source = "ab\ncd";
    // offset 2 is the '\n' itself? no — offset 2 is '\n'. offset 3 is 'c'.
    expect(spanToLineCol([3, 4], source)).toEqual({ line: 2, column: 1 });
  });
});

describe("parseBiomeJsonOutput (pure parser)", () => {
  it("parses a single error diagnostic", () => {
    const json = JSON.stringify({
      summary: { errors: 1, warnings: 0, changed: 0, unchanged: 0, skipped: 0 },
      diagnostics: [
        {
          category: "lint/suspicious/noExplicitAny",
          severity: "error",
          description: "Unexpected any. Specify a different type.",
          location: {
            path: { file: "./src/foo.ts" },
            span: [0, 3],
            sourceCode: "any"
          },
          tags: []
        }
      ],
      command: "ci"
    });

    const { diagnostics, summary } = parseBiomeJsonOutput(json, "/workspace");
    expect(diagnostics).toHaveLength(1);
    const d = diagnostics[0]!;
    expect(d.source).toBe("biome");
    expect(d.severity).toBe("error");
    expect(d.rule).toBe("noExplicitAny");
    expect(d.code).toBe("lint/suspicious/noExplicitAny");
    expect(d.message).toBe("Unexpected any. Specify a different type.");
    expect(d.file).toBe(path.resolve("/workspace", "./src/foo.ts"));
    expect(d.range.line).toBe(1);
    expect(d.range.column).toBe(1);
    expect(d.fixable).toBe(false);
    expect(d.id).toBe(`biome:noExplicitAny:${d.file}:1:1`);

    expect(summary?.errors).toBe(1);
    expect(summary?.warnings).toBe(0);
  });

  it("marks fixable diagnostics from tags array", () => {
    const json = JSON.stringify({
      summary: { errors: 0, warnings: 1, changed: 0, unchanged: 0, skipped: 0 },
      diagnostics: [
        {
          category: "lint/style/useImportType",
          severity: "warning",
          description: "All these imports are only used as types.",
          location: { path: { file: "./src/foo.ts" }, span: [0, 10], sourceCode: "import { X }" },
          tags: ["fixable"]
        }
      ]
    });

    const { diagnostics } = parseBiomeJsonOutput(json, "/workspace");
    expect(diagnostics[0]!.fixable).toBe(true);
  });

  it("handles whole-file diagnostics with null span", () => {
    const json = JSON.stringify({
      summary: { errors: 1, warnings: 0, changed: 0, unchanged: 0, skipped: 0 },
      diagnostics: [
        {
          category: "format",
          severity: "error",
          description: "File content differs from formatting output",
          location: { path: { file: "./src/foo.ts" }, span: null, sourceCode: "" },
          tags: []
        }
      ]
    });

    const { diagnostics } = parseBiomeJsonOutput(json, "/workspace");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.rule).toBe("format");
    expect(diagnostics[0]!.range.line).toBe(1);
    expect(diagnostics[0]!.range.column).toBe(1);
  });

  it("strips ANSI codes before parsing", () => {
    const clean = JSON.stringify({
      summary: { errors: 0, warnings: 0 },
      diagnostics: []
    });
    const withAnsi = "\x1b[0m" + clean + "\x1b[0m";
    const { diagnostics } = parseBiomeJsonOutput(withAnsi, "/workspace");
    expect(diagnostics).toHaveLength(0);
  });

  it("returns empty list for empty stdout", () => {
    const { diagnostics, summary } = parseBiomeJsonOutput("", "/workspace");
    expect(diagnostics).toHaveLength(0);
    expect(summary).toBeUndefined();
  });

  it("throws AdapterParseError on malformed JSON", () => {
    expect(() => parseBiomeJsonOutput("not valid json", "/workspace")).toThrow(/Failed to parse JSON/);
  });
});

describe("BiomeAdapter (integration against fixture)", () => {
  it("resolves local biome and reports real diagnostics", async () => {
    const biomeBin = path.join(FIXTURE, "node_modules", ".bin", "biome");
    try {
      await fs.access(biomeBin);
    } catch {
      console.warn(`[nodeforge:test] skipping Biome integration test — fixture biome missing at ${biomeBin}`);
      return;
    }

    const runner = new ProcessRunner();
    const adapter = new BiomeAdapter(runner, { biomePath: biomeBin });
    const result = await adapter.run(FIXTURE);

    // Biome exits 1 when it finds issues.
    expect(result.exitCode).toBe(1);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(4);

    // Verify we got the expected rule findings.
    const ruleNames = new Set(result.diagnostics.map((d) => d.rule));
    expect(ruleNames.has("noExplicitAny")).toBe(true);
    expect(ruleNames.has("useImportType")).toBe(true);
    expect(ruleNames.has("useConst")).toBe(true);

    // All diagnostics should reference the fixture's broken.ts with absolute paths.
    for (const d of result.diagnostics) {
      expect(path.isAbsolute(d.file)).toBe(true);
      expect(d.file).toContain("broken.ts");
      expect(d.source).toBe("biome");
      expect(d.range.line).toBeGreaterThanOrEqual(1);
      expect(d.range.column).toBeGreaterThanOrEqual(1);
    }

    // Summary should be populated.
    expect(result.summary).toBeDefined();
    expect(result.summary!.errors).toBeGreaterThanOrEqual(3);
    expect(result.summary!.warnings).toBeGreaterThanOrEqual(2);

    // At least one diagnostic should be marked fixable (useImportType, useConst, noConsoleLog).
    const fixable = result.diagnostics.filter((d) => d.fixable);
    expect(fixable.length).toBeGreaterThanOrEqual(1);
  });

  it("detects biome config presence via hasConfig static method", async () => {
    expect(await BiomeAdapter.hasConfig(FIXTURE)).toBe(true);
    expect(await BiomeAdapter.hasConfig(path.dirname(FIXTURE))).toBe(false);
  });
});
