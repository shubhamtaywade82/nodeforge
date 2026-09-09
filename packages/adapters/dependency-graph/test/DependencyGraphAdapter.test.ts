/**
 * Tests for the dependency graph adapter.
 *
 * Includes pure-parser unit tests for import extraction and package name
 * extraction, plus an integration test against the `node-ts-depgraph` fixture
 * which has real unused deps and a circular dependency chain.
 */

import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DependencyGraphAdapter,
  extractImports,
  isRelativeSpecifier,
  extractPackageName
} from "../src/DependencyGraphAdapter.js";

const FIXTURE = path.resolve(__dirname, "../../../test-fixtures/node-ts-depgraph");

describe("extractImports (pure parser)", () => {
  it("extracts default import", () => {
    const source = 'import express from "express";';
    const imports = extractImports(source);
    expect(imports).toHaveLength(1);
    expect(imports[0]!.specifier).toBe("express");
    expect(imports[0]!.kind).toBe("static");
  });

  it("extracts named imports", () => {
    const source = 'import { z } from "zod";';
    const imports = extractImports(source);
    expect(imports[0]!.specifier).toBe("zod");
  });

  it("extracts namespace import", () => {
    const source = 'import * as path from "node:path";';
    const imports = extractImports(source);
    expect(imports[0]!.specifier).toBe("node:path");
  });

  it("extracts side-effect import", () => {
    const source = 'import "dotenv/config";';
    const imports = extractImports(source);
    expect(imports[0]!.specifier).toBe("dotenv/config");
  });

  it("extracts type-only import and marks kind", () => {
    const source = 'import type { Request } from "express";';
    const imports = extractImports(source);
    expect(imports[0]!.specifier).toBe("express");
    expect(imports[0]!.kind).toBe("type");
  });

  it("extracts re-export", () => {
    const source = 'export { foo } from "./bar";';
    const imports = extractImports(source);
    expect(imports[0]!.specifier).toBe("./bar");
  });

  it("extracts wildcard re-export", () => {
    const source = 'export * from "./utils";';
    const imports = extractImports(source);
    expect(imports[0]!.specifier).toBe("./utils");
  });

  it("extracts require() call", () => {
    const source = 'const fs = require("node:fs");';
    const imports = extractImports(source);
    expect(imports[0]!.specifier).toBe("node:fs");
  });

  it("extracts dynamic import", () => {
    const source = 'const mod = await import("./lazy");';
    const imports = extractImports(source);
    // The dynamic import regex adds a "dynamic" entry.
    const dynamic = imports.find((i) => i.kind === "dynamic");
    expect(dynamic).toBeDefined();
    expect(dynamic!.specifier).toBe("./lazy");
  });

  it("handles multiple imports in one file", () => {
    const source = [
      'import express from "express";',
      'import { z } from "zod";',
      'import { helper } from "./utils";',
      'import type { Config } from "./types";',
      ""
    ].join("\n");
    const imports = extractImports(source);
    expect(imports).toHaveLength(4);
    const specifiers = imports.map((i) => i.specifier);
    expect(specifiers).toEqual(expect.arrayContaining(["express", "zod", "./utils", "./types"]));
  });

  it("deduplicates identical imports", () => {
    const source = [
      'import { a } from "lodash";',
      'import { b } from "lodash";',
      ""
    ].join("\n");
    const imports = extractImports(source);
    // Both imports are `static:lodash` — should be deduplicated to one entry.
    const staticLodash = imports.filter((i) => i.kind === "static" && i.specifier === "lodash");
    expect(staticLodash).toHaveLength(1);
  });
});

describe("isRelativeSpecifier", () => {
  it("returns true for relative specifiers", () => {
    expect(isRelativeSpecifier("./foo")).toBe(true);
    expect(isRelativeSpecifier("../bar")).toBe(true);
    expect(isRelativeSpecifier(".")).toBe(true);
    expect(isRelativeSpecifier("..")).toBe(true);
  });

  it("returns false for package specifiers", () => {
    expect(isRelativeSpecifier("express")).toBe(false);
    expect(isRelativeSpecifier("@scope/pkg")).toBe(false);
    expect(isRelativeSpecifier("node:fs")).toBe(false);
  });
});

describe("extractPackageName", () => {
  it("extracts unscoped package name", () => {
    expect(extractPackageName("express")).toBe("express");
  });

  it("extracts package name with subpath", () => {
    expect(extractPackageName("lodash/fp")).toBe("lodash");
    expect(extractPackageName("react/jsx-runtime")).toBe("react");
  });

  it("extracts scoped package name", () => {
    expect(extractPackageName("@scope/pkg")).toBe("@scope/pkg");
  });

  it("extracts scoped package name with subpath", () => {
    expect(extractPackageName("@scope/pkg/sub")).toBe("@scope/pkg");
  });

  it("returns undefined for relative specifiers", () => {
    expect(extractPackageName("./foo")).toBeUndefined();
    expect(extractPackageName("../bar")).toBeUndefined();
  });

  it("returns undefined for node: builtins", () => {
    expect(extractPackageName("node:fs")).toBeUndefined();
    expect(extractPackageName("node:path")).toBeUndefined();
  });
});

describe("DependencyGraphAdapter (integration against fixture)", () => {
  it("builds graph with file and package nodes", async () => {
    const adapter = new DependencyGraphAdapter();
    const analysis = await adapter.analyze(FIXTURE);

    // Should have file nodes for a.ts, b.ts, c.ts, index.ts.
    const fileNodes = analysis.graph.nodes.filter((n) => n.kind === "file");
    const fileNames = fileNodes.map((n) => path.basename(n.path!)).sort();
    expect(fileNames).toEqual(expect.arrayContaining(["a.ts", "b.ts", "c.ts", "index.ts"]));

    // Should have package nodes for express, zod, lodash.
    const pkgNodes = analysis.graph.nodes.filter((n) => n.kind === "package");
    const pkgNames = pkgNodes.map((n) => n.name);
    expect(pkgNames).toEqual(expect.arrayContaining(["express", "zod", "lodash"]));
  });

  it("detects unused dependencies", async () => {
    const adapter = new DependencyGraphAdapter();
    const analysis = await adapter.analyze(FIXTURE);

    // `lodash` is declared but never imported → unused.
    const lodash = analysis.unused.find((u) => u.packageName === "lodash");
    expect(lodash).toBeDefined();
    expect(lodash!.dependencyType).toBe("prod");
    expect(lodash!.likelyFalsePositive).toBe(false);

    // `typescript`, `eslint`, `vitest` are devDeps that are false positives.
    const ts = analysis.unused.find((u) => u.packageName === "typescript");
    expect(ts).toBeDefined();
    expect(ts!.likelyFalsePositive).toBe(true);
    expect(ts!.falsePositiveReason).toBeDefined();
  });

  it("does not flag imported packages as unused", async () => {
    const adapter = new DependencyGraphAdapter();
    const analysis = await adapter.analyze(FIXTURE);

    // express and zod are imported, so they should NOT be in the unused list.
    expect(analysis.unused.find((u) => u.packageName === "express")).toBeUndefined();
    expect(analysis.unused.find((u) => u.packageName === "zod")).toBeUndefined();
  });

  it("detects circular dependencies among file nodes", async () => {
    const adapter = new DependencyGraphAdapter();
    const analysis = await adapter.analyze(FIXTURE);

    // The fixture has a circular dependency: a → b → c → a.
    expect(analysis.circular.length).toBeGreaterThanOrEqual(1);

    // The cycle should involve a.ts, b.ts, c.ts.
    const cycle = analysis.circular[0]!;
    const cycleBases = cycle.chain.map((f) => path.basename(f));
    expect(cycleBases).toEqual(expect.arrayContaining(["a.ts", "b.ts", "c.ts"]));
    expect(cycle.length).toBeGreaterThanOrEqual(3);
  });

  it("builds edges for both relative and package imports", async () => {
    const adapter = new DependencyGraphAdapter();
    const analysis = await adapter.analyze(FIXTURE);

    // Should have file→file edges (a.ts → b.ts, b.ts → c.ts, c.ts → a.ts)
    const fileEdges = analysis.graph.edges.filter(
      (e) => !e.specifier.startsWith("@") && !e.specifier.startsWith("express") && !e.specifier.startsWith("zod")
    );
    // Actually, filter by checking if the target is a file path
    const fileToFileEdges = analysis.graph.edges.filter((e) => {
      const fromNode = analysis.graph.nodes.find((n) => n.id === e.from);
      const toNode = analysis.graph.nodes.find((n) => n.id === e.to);
      return fromNode?.kind === "file" && toNode?.kind === "file";
    });
    expect(fileToFileEdges.length).toBeGreaterThanOrEqual(3);

    // Should have file→package edges (index.ts → express, a.ts → express, a.ts → zod)
    const fileToPkgEdges = analysis.graph.edges.filter((e) => {
      const fromNode = analysis.graph.nodes.find((n) => n.id === e.from);
      const toNode = analysis.graph.nodes.find((n) => n.id === e.to);
      return fromNode?.kind === "file" && toNode?.kind === "package";
    });
    expect(fileToPkgEdges.length).toBeGreaterThanOrEqual(3);
  });

  it("hasConfig returns true for workspace with package.json", async () => {
    expect(await DependencyGraphAdapter.hasConfig(FIXTURE)).toBe(true);
    // The parent directory (test-fixtures/) doesn't have a package.json at its root.
    expect(await DependencyGraphAdapter.hasConfig(path.dirname(FIXTURE))).toBe(false);
  });

  it("detects missing dependencies (imported but not declared)", async () => {
    // This fixture doesn't have missing deps (all imports resolve to declared
    // packages or are relative). But the test verifies the field exists.
    const adapter = new DependencyGraphAdapter();
    const analysis = await adapter.analyze(FIXTURE);
    expect(analysis.missing).toBeDefined();
    expect(Array.isArray(analysis.missing)).toBe(true);
  });
});
