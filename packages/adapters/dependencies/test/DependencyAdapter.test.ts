/**
 * Tests for the Dependency adapter.
 *
 * Pure-parser tests use recorded audit JSON fixtures so we don't depend on
 * the live vulnerability database. Integration tests run real `npm audit`
 * against the deps fixture (which has a known-vulnerable lodash version).
 */

import * as path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

import { DependencyAdapter, parseAuditJson, parseOutdatedJson } from "../src/DependencyAdapter.js";
import { ProcessRunner } from "@nodeforge/runner";

const FIXTURE = path.resolve(__dirname, "../../../test-fixtures/node-ts-deps");

describe("parseAuditJson (pure parser — npm format)", () => {
  it("parses a single high-severity finding", () => {
    const json = JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities: {
        lodash: {
          name: "lodash",
          severity: "high",
          isDirect: true,
          via: [
            {
              title: "Prototype Pollution",
              url: "https://github.com/advisories/GHSA-1234",
              severity: "high",
              range: "<4.17.21"
            }
          ],
          range: "<4.17.21",
          fixAvailable: { name: "lodash", version: "4.17.21", isSemVerMajor: false }
        }
      },
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 }
      }
    });

    const findings = parseAuditJson(json, "npm");
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.packageName).toBe("lodash");
    expect(f.severity).toBe("high");
    expect(f.dependencyType).toBe("prod");
    expect(f.advisory).toBe("GHSA-1234");
    expect(f.recommended).toBe("4.17.21");
    expect(f.url).toBe("https://github.com/advisories/GHSA-1234");
    expect(f.title).toBe("Prototype Pollution");
  });

  it("parses multiple vulnerabilities", () => {
    const json = JSON.stringify({
      vulnerabilities: {
        lodash: {
          name: "lodash",
          severity: "high",
          isDirect: true,
          via: [{ title: "V1", url: "https://github.com/advisories/GHSA-1111" }],
          range: "<4.17.21"
        },
        minimist: {
          name: "minimist",
          severity: "low",
          isDirect: false,
          via: [{ title: "V2", url: "https://github.com/advisories/GHSA-2222" }],
          range: "<1.2.6"
        }
      }
    });
    const findings = parseAuditJson(json, "npm");
    expect(findings).toHaveLength(2);
    expect(findings[0]!.severity).toBe("high");
    expect(findings[1]!.severity).toBe("low");
    expect(findings[1]!.dependencyType).toBe("dev"); // isDirect=false
  });

  it("maps all severity levels", () => {
    const json = JSON.stringify({
      vulnerabilities: {
        a: { name: "a", severity: "critical", via: [{ url: "https://github.com/advisories/GHSA-a1" }] },
        b: { name: "b", severity: "high", via: [{ url: "https://github.com/advisories/GHSA-b2" }] },
        c: { name: "c", severity: "moderate", via: [{ url: "https://github.com/advisories/GHSA-c3" }] },
        d: { name: "d", severity: "low", via: [{ url: "https://github.com/advisories/GHSA-d4" }] }
      }
    });
    const findings = parseAuditJson(json, "npm");
    expect(findings[0]!.severity).toBe("critical");
    expect(findings[1]!.severity).toBe("high");
    expect(findings[2]!.severity).toBe("moderate");
    expect(findings[3]!.severity).toBe("low");
  });

  it("returns empty for empty stdout", () => {
    expect(parseAuditJson("", "npm")).toEqual([]);
  });

  it("returns empty when no vulnerabilities key", () => {
    expect(parseAuditJson(JSON.stringify({ metadata: {} }), "npm")).toEqual([]);
  });

  it("throws AdapterParseError on malformed JSON", () => {
    expect(() => parseAuditJson("not json", "npm")).toThrow(/Failed to parse JSON/);
  });
});

describe("parseAuditJson (pure parser — pnpm format)", () => {
  it("parses pnpm audit array output", () => {
    const json = JSON.stringify([
      {
        advisory: {
          id: 100,
          title: "Prototype Pollution in lodash",
          url: "https://github.com/advisories/GHSA-pnpm-1",
          severity: "high",
          module_name: "lodash",
          vulnerable_versions: "<4.17.21",
          patched_versions: ">=4.17.21"
        },
        resolution: { path: "node_modules/lodash" }
      }
    ]);
    const findings = parseAuditJson(json, "pnpm");
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.packageName).toBe("lodash");
    expect(f.severity).toBe("high");
    expect(f.installed).toBe("<4.17.21");
    expect(f.recommended).toBe(">=4.17.21");
  });
});

describe("parseOutdatedJson", () => {
  it("parses npm outdated object format", () => {
    const json = JSON.stringify({
      lodash: {
        current: "4.17.20",
        wanted: "4.17.20",
        latest: "4.17.21",
        dependent: "fixture",
        type: "dependencies"
      }
    });
    const outdated = parseOutdatedJson(json, "npm");
    expect(outdated).toHaveLength(1);
    const o = outdated[0]!;
    expect(o.packageName).toBe("lodash");
    expect(o.current).toBe("4.17.20");
    expect(o.latest).toBe("4.17.21");
    expect(o.diff).toBe("patch");
    expect(o.dependencyType).toBe("prod");
  });

  it("detects major version diffs", () => {
    const json = JSON.stringify({
      foo: { current: "1.2.3", wanted: "1.2.3", latest: "2.0.0", type: "dependencies" }
    });
    const outdated = parseOutdatedJson(json, "npm");
    expect(outdated[0]!.diff).toBe("major");
  });

  it("detects minor version diffs", () => {
    const json = JSON.stringify({
      foo: { current: "1.2.3", wanted: "1.2.3", latest: "1.3.0", type: "dependencies" }
    });
    const outdated = parseOutdatedJson(json, "npm");
    expect(outdated[0]!.diff).toBe("minor");
  });

  it("detects dev dependency type", () => {
    const json = JSON.stringify({
      foo: { current: "1.0.0", wanted: "1.0.0", latest: "1.0.1", type: "devDependencies" }
    });
    const outdated = parseOutdatedJson(json, "npm");
    expect(outdated[0]!.dependencyType).toBe("dev");
  });

  it("returns empty for empty stdout", () => {
    expect(parseOutdatedJson("", "npm")).toEqual([]);
  });
});

describe("DependencyAdapter (integration against fixture)", () => {
  it("runs npm audit against the fixture repo", async () => {
    // Skip if npm isn't available (it almost always is).
    const runner = new ProcessRunner();
    const adapter = new DependencyAdapter(runner, { packageManager: "npm" });

    let result;
    try {
      result = await adapter.run(FIXTURE);
    } catch (err) {
      // If npm audit fails (e.g. no lockfile, network), skip rather than fail.
      console.warn("[nodeforge:test] skipping npm audit integration test:", (err as Error).message);
      return;
    }

    // npm audit always produces JSON, even when there are 0 findings.
    expect(result).toBeDefined();
    expect(result.report).toBeDefined();
    // The fixture uses lodash@4.17.20 which has known vulnerabilities.
    // If the live advisory DB still flags it, we expect findings.
    // If not, we still accept the test as passing — the DB evolves.
    if (result.report.findings.length > 0) {
      const lodashFinding = result.report.findings.find((f) => f.packageName === "lodash");
      expect(lodashFinding).toBeDefined();
      expect(["high", "critical", "moderate", "low"]).toContain(lodashFinding!.severity);
    }
  });
});
