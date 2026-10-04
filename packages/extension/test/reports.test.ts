import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Diagnostic } from "@nodeforge/contracts";
import {
  REPORTS,
  parseReportPath,
  renderDiagnosticsMarkdown,
  renderGitDiff,
  renderJson,
  reportPath
} from "../src/reports/reports.ts";

const diag = (over: Partial<Diagnostic>): Diagnostic => ({
  id: "x",
  source: "typescript",
  severity: "error",
  message: "boom",
  file: "/w/src/a.ts",
  range: { line: 3, column: 5 },
  fixable: false,
  ...over
});

describe("report paths", () => {
  it("round-trips every descriptor", () => {
    for (const r of REPORTS) assert.equal(parseReportPath(reportPath(r)), r);
  });

  it("rejects unknown kinds, wrong extensions and traversal", () => {
    assert.equal(parseReportPath("/nope.json"), undefined);
    assert.equal(parseReportPath("/diagnostics.json"), undefined);
    assert.equal(parseReportPath("/../etc/passwd"), undefined);
    assert.equal(parseReportPath(""), undefined);
  });
});

describe("renderDiagnosticsMarkdown", () => {
  it("renders an empty state", () => {
    assert.match(renderDiagnosticsMarkdown([], "/w"), /No findings\./);
  });

  it("groups by file, orders by severity then position, and relativizes paths", () => {
    const md = renderDiagnosticsMarkdown(
      [
        diag({ id: "1", severity: "warning", message: "w", range: { line: 1, column: 1 }, rule: "no-x", source: "eslint" }),
        diag({ id: "2", severity: "error", message: "multi\n  line", range: { line: 9, column: 2 }, code: 2304 }),
        diag({ id: "3", file: "/w/b.ts", severity: "info", message: "i", fixable: true })
      ],
      "/w"
    );
    assert.match(md, /3 findings: 1 error, 1 warning, 1 info/);
    assert.ok(md.indexOf("## b.ts") < md.indexOf("## src/a.ts"));
    assert.ok(md.indexOf("**error**") < md.indexOf("**warning**"));
    assert.match(md, /`typescript\/2304` 9:2 — multi line/);
    assert.match(md, /`eslint\/no-x` 1:1/);
    assert.match(md, /_\(fixable\)_/);
  });
});

describe("renderers", () => {
  it("renders git diffs and the empty state", () => {
    assert.equal(renderGitDiff(undefined), "# No changes\n");
    assert.equal(renderGitDiff({ scope: "working", files: ["a"], patch: "diff --git" }), "diff --git\n");
  });

  it("renders json with a trailing newline and null for undefined", () => {
    assert.equal(renderJson({ a: 1 }), '{\n  "a": 1\n}\n');
    assert.equal(renderJson(undefined), "null\n");
  });
});
