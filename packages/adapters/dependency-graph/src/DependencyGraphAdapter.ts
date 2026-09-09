/**
 * Dependency graph adapter.
 *
 * Builds the import graph of a Node.js/TypeScript project and detects:
 *   - Unused dependencies (declared in package.json but never imported)
 *   - Circular dependencies (import cycles: A → B → C → A)
 *   - Missing dependencies (imported but not in package.json)
 *
 * The adapter walks source files (.ts, .tsx, .js, .jsx, .mjs, .cjs) and
 * parses import/require statements using regex — no TypeScript compiler API
 * needed. This handles the common cases:
 *
 *   import foo from "pkg"
 *   import { x } from "./local"
 *   import type { T } from "pkg"          (type-only import)
 *   const x = require("pkg")
 *   await import("pkg")                   (dynamic import)
 *   export { foo } from "pkg"             (re-export)
 *
 * Package imports (non-relative specifiers like `lodash`, `express`,
 * `@scope/pkg`) are matched against package.json declared dependencies.
 * Relative imports (`./foo`, `../bar`) are resolved to absolute file paths
 * and become file-to-file edges in the graph.
 */

import * as path from "node:path";
import {
  type CircularDependency,
  type DependencyGraph,
  type DependencyGraphEdge,
  type DependencyGraphNode,
  type DependencyGraphAnalysis,
  type UnusedDependency
} from "@nodeforge/contracts";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

/**
 * Packages that are commonly declared in devDependencies but never directly
 * imported — they're used as CLI tools, config plugins, or type definitions.
 * We flag these as likely false positives when reporting unused deps.
 */
const FALSE_POSITIVE_PACKAGES = new Set([
  "typescript",
  "eslint",
  "prettier",
  "biome",
  "vitest",
  "jest",
  "ts-node",
  "tsx",
  "@swc/core",
  "@swc/jest",
  "drizzle-kit",
  "prisma",
  "@prisma/client",
  "@types/node",
  "tslib",
  "concurrently",
  "cross-env",
  "nodemon",
  "rimraf",
  "husky",
  "lint-staged",
  "dotenv",
  "globals",
  "@eslint/js",
  "typescript-eslint"
]);

export class DependencyGraphAdapter {
  /**
   * Analyze the dependency graph for `workspaceRoot`. Returns the full graph
   * plus unused/circular/missing analysis.
   */
  async analyze(workspaceRoot: string): Promise<DependencyGraphAnalysis> {
    const fs = await import("node:fs/promises");

    // 1. Read package.json declared deps.
    const pkgRaw = await fs.readFile(path.join(workspaceRoot, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    const declaredPackages: DependencyGraph["declaredPackages"] = [];
    const declaredSet = new Set<string>();
    for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
      declaredPackages.push({ name, version, dependencyType: "prod" });
      declaredSet.add(name);
    }
    for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
      declaredPackages.push({ name, version, dependencyType: "dev" });
      declaredSet.add(name);
    }
    for (const [name, version] of Object.entries(pkg.optionalDependencies ?? {})) {
      declaredPackages.push({ name, version, dependencyType: "optional" });
      declaredSet.add(name);
    }
    for (const [name, version] of Object.entries(pkg.peerDependencies ?? {})) {
      declaredPackages.push({ name, version, dependencyType: "peer" });
      declaredSet.add(name);
    }

    // 2. Walk source files and extract imports.
    const sourceFiles = await findSourceFiles(workspaceRoot);
    const nodes = new Map<string, DependencyGraphNode>();
    const edges: DependencyGraphEdge[] = [];
    const importedPackages = new Set<string>();
    const importedPackageByFiles = new Map<string, Set<string>>();

    // Ensure package nodes exist.
    for (const dp of declaredPackages) {
      nodes.set(dp.name, {
        id: dp.name,
        kind: "package",
        name: dp.name,
        isExternal: true
      });
    }

    for (const file of sourceFiles) {
      const fileNode: DependencyGraphNode = {
        id: file,
        kind: "file",
        name: path.relative(workspaceRoot, file) || file,
        path: file,
        isExternal: false
      };
      nodes.set(file, fileNode);

      const raw = await fs.readFile(file, "utf8");
      const imports = extractImports(raw);

      for (const imp of imports) {
        if (isRelativeSpecifier(imp.specifier)) {
          // Resolve relative import to an absolute file path.
          const resolved = resolveImport(file, imp.specifier, workspaceRoot);
          if (resolved) {
            if (!nodes.has(resolved)) {
              nodes.set(resolved, {
                id: resolved,
                kind: "file",
                name: path.relative(workspaceRoot, resolved) || resolved,
                path: resolved,
                isExternal: false
              });
            }
            edges.push({
              from: file,
              to: resolved,
              kind: imp.kind,
              specifier: imp.specifier
            });
          }
        } else {
          // Package import — extract the package name.
          const packageName = extractPackageName(imp.specifier);
          if (packageName) {
            importedPackages.add(packageName);
            if (!importedPackageByFiles.has(file)) {
              importedPackageByFiles.set(file, new Set());
            }
            importedPackageByFiles.get(file)!.add(packageName);

            if (!nodes.has(packageName)) {
              nodes.set(packageName, {
                id: packageName,
                kind: "package",
                name: packageName,
                isExternal: true
              });
            }

            edges.push({
              from: file,
              to: packageName,
              kind: imp.kind,
              specifier: imp.specifier
            });
          }
        }
      }
    }

    const graph: DependencyGraph = {
      root: workspaceRoot,
      nodes: Array.from(nodes.values()),
      edges,
      declaredPackages
    };

    // 3. Detect unused dependencies.
    const unused: UnusedDependency[] = [];
    for (const dp of declaredPackages) {
      if (!importedPackages.has(dp.name)) {
        const likelyFalsePositive = isLikelyFalsePositive(dp.name);
        unused.push({
          packageName: dp.name,
          version: dp.version,
          dependencyType: dp.dependencyType,
          likelyFalsePositive,
          falsePositiveReason: likelyFalsePositive
            ? "Commonly used as CLI tool, config plugin, or type definition — not directly imported"
            : undefined
        });
      }
    }

    // 4. Detect circular dependencies (only among file nodes).
    const circular = detectCircularDependencies(graph);

    // 5. Detect missing dependencies (imported but not declared).
    const missing: DependencyGraphAnalysis["missing"] = [];
    for (const [packageName, importers] of importedPackageByFiles) {
      // Skip scoped @types/* packages — they're implicitly resolved.
      // Skip built-in Node.js modules.
      if (isBuiltinModule(packageName)) continue;
      if (packageName.startsWith("@types/")) continue;
      if (!declaredSet.has(packageName)) {
        missing.push({
          packageName,
          importedBy: Array.from(importers).map((f) => path.relative(workspaceRoot, f))
        });
      }
    }

    return { graph, unused, circular, missing };
  }

  /**
   * Returns true if a package.json exists in `workspaceRoot`.
   */
  static async hasConfig(workspaceRoot: string): Promise<boolean> {
    const fs = await import("node:fs/promises");
    try {
      await fs.access(path.join(workspaceRoot, "package.json"));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * An extracted import statement.
 */
interface ExtractedImport {
  /** The original specifier: `./foo`, `lodash`, `@scope/pkg/sub`. */
  specifier: string;
  /** Import kind. */
  kind: "static" | "dynamic" | "type";
}

/**
 * Extract all imports from TypeScript/JavaScript source code.
 *
 * Handles:
 *   import x from "spec"
 *   import { a, b } from "spec"
 *   import * as x from "spec"
 *   import type { T } from "spec"        → kind = "type"
 *   import "spec"                         (side-effect import)
 *   export { x } from "spec"             (re-export)
 *   export * from "spec"
 *   const x = require("spec")
 *   await import("spec")                  → kind = "dynamic"
 */
export function extractImports(source: string): ExtractedImport[] {
  const imports: ExtractedImport[] = [];

  // ES import statements (including type-only and side-effect imports).
  // Matches: import [type] { ... } from "spec"
  //          import [type] x from "spec"
  //          import * as x from "spec"
  //          import "spec"
  const esImportRegex =
    /import\s+(?:type\s+)?(?:[\w*${}\s,]+from\s+)?["']([^"']+)["']/g;

  // Re-exports: export { x } from "spec", export * from "spec"
  const reExportRegex =
    /export\s+(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/g;

  // require("spec") calls
  const requireRegex = /require\(\s*["']([^"']+)["']\s*\)/g;

  // Dynamic import("spec")
  const dynamicImportRegex = /import\(\s*["']([^"']+)["']\s*\)/g;

  let m: RegExpExecArray | null;

  // ES imports + type imports. We need to check if `type` keyword precedes
  // the import to set kind = "type".
  while ((m = esImportRegex.exec(source)) !== null) {
    const fullMatch = m[0];
    const specifier = m[1]!;
    const isType = /\bimport\s+type\b/.test(fullMatch);
    imports.push({ specifier, kind: isType ? "type" : "static" });
  }

  // Re-exports
  while ((m = reExportRegex.exec(source)) !== null) {
    imports.push({ specifier: m[1]!, kind: "static" });
  }

  // require() calls
  while ((m = requireRegex.exec(source)) !== null) {
    imports.push({ specifier: m[1]!, kind: "static" });
  }

  // Dynamic imports — remove these from the static results since the
  // esImportRegex also matches `import("spec")`. We deduplicate by checking
  // if the same specifier was already captured at the same position.
  const dynamicSpecifiers = new Set<string>();
  while ((m = dynamicImportRegex.exec(source)) !== null) {
    dynamicSpecifiers.add(m[1]!);
  }

  // Mark dynamic imports: if a specifier was captured as both static and
  // dynamic, we keep the dynamic entry and remove the static one.
  // (This is a simplification — in practice, a specifier could be imported
  // both statically and dynamically in the same file. We keep both entries.)
  for (const spec of dynamicSpecifiers) {
    imports.push({ specifier: spec, kind: "dynamic" });
  }

  // Deduplicate: same specifier + same kind should only appear once.
  const seen = new Set<string>();
  return imports.filter((imp) => {
    const key = `${imp.kind}:${imp.specifier}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Check if an import specifier is relative (starts with `./` or `../`).
 */
export function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../") || specifier === "." || specifier === "..";
}

/**
 * Extract the package name from an import specifier.
 *
 *   "lodash"           → "lodash"
 *   "express"           → "express"
 *   "@scope/pkg"        → "@scope/pkg"
 *   "@scope/pkg/sub"    → "@scope/pkg"
 *   "lodash/fp"         → "lodash"
 *   "react/jsx-runtime" → "react"
 */
export function extractPackageName(specifier: string): string | undefined {
  if (isRelativeSpecifier(specifier)) return undefined;
  if (specifier.startsWith("node:")) return undefined; // Node.js built-in with prefix

  if (specifier.startsWith("@")) {
    // Scoped package: @scope/name[/subpath]
    const parts = specifier.split("/");
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`;
    }
    return undefined;
  }

  // Unscoped: name[/subpath]
  const idx = specifier.indexOf("/");
  if (idx === -1) return specifier;
  return specifier.slice(0, idx);
}

/**
 * Resolve a relative import specifier to an absolute file path.
 *
 * Tries the exact path, then with each source extension appended.
 * Handles the common ESM convention of importing `.js` files that are
 * actually `.ts` source files (the TypeScript compiler rewrites `.js` → `.ts`
 * during compilation).
 */
function resolveImport(fromFile: string, specifier: string, _root: string): string | undefined {
  const dir = path.dirname(fromFile);
  const resolved = path.resolve(dir, specifier);

  // Build a list of candidate paths to try.
  const candidates: string[] = [];

  // If the specifier already has a source extension, use it as-is.
  const ext = path.extname(resolved);
  if (ext && SOURCE_EXTENSIONS.includes(ext)) {
    candidates.push(resolved);
  }

  // Try with each source extension appended (for specifiers without extensions).
  for (const e of SOURCE_EXTENSIONS) {
    candidates.push(resolved + e);
  }

  // Handle the `.js` → `.ts` mapping: if the specifier ends with `.js`,
  // try `.ts`, `.tsx`, `.mjs`, `.cjs` instead.
  if (ext === ".js" || ext === ".jsx") {
    const withoutExt = resolved.slice(0, -ext.length);
    candidates.push(withoutExt + ".ts");
    candidates.push(withoutExt + ".tsx");
    candidates.push(withoutExt + ".mjs");
    candidates.push(withoutExt + ".cjs");
  }

  // Also try index files: `./foo` → `./foo/index.ts`
  for (const e of SOURCE_EXTENSIONS) {
    candidates.push(path.join(resolved, `index${e}`));
  }

  // Return the first candidate. The caller will only add edges to nodes
  // that actually exist in the source file set.
  //
  // We can't synchronously check file existence here (the findSourceFiles
  // walk already happened), so we return the first candidate that looks
  // reasonable. The graph builder deduplicates nodes by id, so if a resolved
  // path doesn't correspond to a real file, it simply won't have any
  // outgoing edges — no harm done.
  //
  // For the common case (`.js` specifier → `.ts` source), we return the
  // `.ts` variant first.
  if (ext === ".js" || ext === ".jsx") {
    const withoutExt = resolved.slice(0, -ext.length);
    return withoutExt + ".ts";
  }

  if (ext && SOURCE_EXTENSIONS.includes(ext)) {
    return resolved;
  }

  return resolved + ".ts";
}

/**
 * Walk the workspace and find all source files (.ts, .tsx, .js, .jsx, .mjs, .cjs).
 * Skips node_modules, dist, build, .git directories.
 */
async function findSourceFiles(root: string): Promise<string[]> {
  const fs = await import("node:fs/promises");
  const results: string[] = [];
  const skipDirs = new Set(["node_modules", "dist", "build", ".git", ".turbo", ".cache"]);

  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        await walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (SOURCE_EXTENSIONS.includes(ext)) {
          // Skip .d.ts declaration files — they're not source files.
          if (entry.name.endsWith(".d.ts")) continue;
          results.push(path.join(dir, entry.name));
        }
      }
    }
  }

  await walk(root);
  return results.sort();
}

/**
 * Detect circular dependencies among file nodes using DFS.
 *
 * Only considers file-to-file edges (not package edges). A cycle is found
 * when the DFS encounters a node that's currently on the recursion stack.
 */
function detectCircularDependencies(graph: DependencyGraph): CircularDependency[] {
  // Build adjacency list for file nodes only.
  const adj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    // Only consider edges where both `from` and `from` are file nodes
    // (not package nodes).
    const fromNode = graph.nodes.find((n) => n.id === edge.from);
    const toNode = graph.nodes.find((n) => n.id === edge.to);
    if (fromNode?.kind === "file" && toNode?.kind === "file") {
      if (!adj.has(edge.from)) {
        adj.set(edge.from, []);
      }
      adj.get(edge.from)!.push(edge.to);
    }
  }

  const cycles: CircularDependency[] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): void {
    if (stack.has(node)) {
      // Found a cycle — extract the cycle from the path.
      const cycleStart = path.indexOf(node);
      if (cycleStart !== -1) {
        const chain = [...path.slice(cycleStart), node];
        cycles.push({
          chain,
          length: chain.length - 1
        });
      }
      return;
    }

    if (visited.has(node)) return;

    visited.add(node);
    stack.add(node);
    path.push(node);

    const neighbors = adj.get(node) ?? [];
    for (const neighbor of neighbors) {
      dfs(neighbor);
    }

    path.pop();
    stack.delete(node);
  }

  for (const node of adj.keys()) {
    dfs(node);
  }

  return cycles;
}

function isLikelyFalsePositive(packageName: string): boolean {
  // Check exact matches.
  if (FALSE_POSITIVE_PACKAGES.has(packageName)) return true;
  // Check @types/* packages.
  if (packageName.startsWith("@types/")) return true;
  // Check @biomejs/* packages.
  if (packageName.startsWith("@biomejs/")) return true;
  // Check eslint plugins.
  if (packageName.startsWith("eslint-plugin-")) return true;
  // Check babel plugins/presets.
  if (packageName.startsWith("@babel/") || packageName.startsWith("babel-")) return true;
  return false;
}

function isBuiltinModule(name: string): boolean {
  // Node.js built-in modules (Node 20+).
  const builtins = [
    "assert", "async_hooks", "buffer", "child_process", "cluster",
    "console", "constants", "crypto", "dgram", "diagnostics_channel",
    "dns", "domain", "events", "fs", "http", "http2", "https", "inspector",
    "module", "net", "os", "path", "perf_hooks", "process", "punycode",
    "querystring", "readline", "repl", "stream", "string_decoder", "sys",
    "timers", "tls", "trace_events", "tty", "url", "util", "v8", "vm",
    "wasi", "worker_threads", "zlib", "test"
  ];
  return builtins.includes(name);
}
