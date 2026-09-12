/**
 * Workspace detector.
 *
 * Pure filesystem inspection — no process spawning, no network. The detector
 * reads package.json, lockfiles, and config files, then produces a
 * `WorkspaceProfile` that every other NodeForge subsystem consults.
 *
 * The detector is deliberately conservative: it only sets a field to a value
 * when it has direct evidence. When evidence is missing, the field stays
 * `undefined` (or `unknown` for the discriminated union fields).
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type {
  MonorepoKind,
  PackageManager,
  NodeRuntime,
  WorkspaceProfile,
  WorkspaceSignals
} from "@nodeforge/contracts";

/** A small filesystem helper passed into detectors so they can be unit-tested with a fake FS. */
export interface FilesystemReader {
  readFile(p: string): Promise<string | undefined>;
  exists(p: string): Promise<boolean>;
  readDir(p: string): Promise<string[]>;
  glob(pattern: string, cwd: string): Promise<string[]>;
}

/** Default implementation using `node:fs` and a tiny glob walker. */
export class NodeFilesystemReader implements FilesystemReader {
  async readFile(p: string): Promise<string | undefined> {
    try {
      return await fs.readFile(p, "utf8");
    } catch (err) {
      if (isEnoent(err)) return undefined;
      throw err;
    }
  }

  async exists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  async readDir(p: string): Promise<string[]> {
    try {
      return await fs.readdir(p);
    } catch (err) {
      if (isEnoent(err)) return [];
      throw err;
    }
  }

  /**
   * Tiny, safe glob. Supports `**` for directory recursion and a single `*`
   * for filename wildcards — enough for the detector's needs. Real adapter
   * code should use a dedicated glob library; this is intentionally minimal.
   */
  async glob(pattern: string, cwd: string): Promise<string[]> {
    const results: string[] = [];
    const seen = new Set<string>();
    await walk(pattern, cwd, cwd, results, seen, 0);
    return results.sort();
  }
}

const MAX_GLOB_DEPTH = 12;

async function walk(
  pattern: string,
  baseDir: string,
  currentDir: string,
  results: string[],
  seen: Set<string>,
  depth: number
): Promise<void> {
  if (depth > MAX_GLOB_DEPTH) return;

  // Skip node_modules, .git, dist — we never want to recurse into these.
  const segments = path.relative(baseDir, currentDir).split(path.sep);
  if (segments.some((s) => s === "node_modules" || s === ".git" || s === "dist" || s === "build")) {
    return;
  }

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  const [head, ...rest] = splitPattern(pattern);

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);

    if (head === "**") {
      // `**` matches zero or more path segments.
      if (rest.length === 0) {
        if (entry.isFile()) addResult(fullPath, baseDir, results, seen);
      } else {
        // Try matching rest against this same directory (zero-segment match).
        await walk(rest.join("/"), baseDir, currentDir, results, seen, depth + 1);
      }
      if (entry.isDirectory()) {
        await walk(pattern, baseDir, fullPath, results, seen, depth + 1);
      }
    } else if (head === "*") {
      if (rest.length === 0) {
        // `*` at the leaf matches both files and directories.
        if (matchSegments(head, entry.name) && !isHidden(entry.name)) {
          addResult(fullPath, baseDir, results, seen);
        }
      } else if (entry.isDirectory() && rest[0] !== undefined) {
        await walk(rest.join("/"), baseDir, fullPath, results, seen, depth + 1);
      }
    } else {
      if (entry.name === head) {
        if (rest.length === 0) {
          addResult(fullPath, baseDir, results, seen);
        } else if (entry.isDirectory()) {
          await walk(rest.join("/"), baseDir, fullPath, results, seen, depth + 1);
        }
      }
    }
  }
}

function splitPattern(pattern: string): string[] {
  // Normalize to forward slashes for parsing.
  return pattern.replace(/\\/g, "/").split("/").filter((s) => s.length > 0);
}

function matchSegments(pattern: string, name: string): boolean {
  // Single `*` pattern, no path separators.
  const re = new RegExp(`^${escapeRegex(pattern).replace(/\\\*/g, ".*")}$`);
  return re.test(name);
}

function escapeRegex(s: string): string {
  return s.replace(/[.+^${}()|[\]\\*?]/g, "\\$&");
}

function addResult(absPath: string, baseDir: string, results: string[], seen: Set<string>): void {
  const rel = path.relative(baseDir, absPath);
  if (seen.has(rel)) return;
  seen.add(rel);
  results.push(rel);
}

function isHidden(name: string): boolean {
  return name.startsWith(".");
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "ENOENT";
}

interface NormalizedPackageJson {
  name?: string;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
  private?: boolean;
}

/**
 * Detect the workspace profile for `root`.
 *
 * @param root absolute path to the workspace root.
 * @param fs   optional filesystem reader (defaults to NodeFilesystemReader).
 */
export async function detectWorkspaceProfile(
  root: string,
  reader: FilesystemReader = new NodeFilesystemReader()
): Promise<WorkspaceProfile> {
  const absoluteRoot = path.isAbsolute(root) ? root : path.resolve(process.cwd(), root);
  const signals: WorkspaceSignals = {
    files: {},
    configFiles: {}
  };

  // 1. Detect package.json + lockfiles + package manager.
  const pkgPath = path.join(absoluteRoot, "package.json");
  const pkgRaw = await reader.readFile(pkgPath);
  let pkg: NormalizedPackageJson | undefined;
  if (pkgRaw) {
    signals.files["package.json"] = true;
    signals.configFiles["package.json"] = pkgPath;
    try {
      pkg = JSON.parse(pkgRaw) as NormalizedPackageJson;
      signals.engines = pkg.engines;
      signals.scripts = pkg.scripts;
    } catch {
      pkg = undefined;
    }
  }

  const packageManager = await detectPackageManager(absoluteRoot, reader, signals);
  const runtime = detectRuntime(pkg, packageManager, signals);
  const typescript = await detectTypeScript(absoluteRoot, pkg, reader, signals);

  // 2. Linter / formatter.
  const linter = await detectLinter(absoluteRoot, reader, signals);
  const formatter = await detectFormatter(absoluteRoot, reader, signals);

  // 3. Test runner.
  const testRunner = detectTestRunner(pkg, signals);

  // 4. ORM.
  const orm = await detectOrm(absoluteRoot, reader, signals);

  // 5. Infrastructure.
  const docker = await detectDocker(absoluteRoot, reader, signals);
  const kubernetes = await detectKubernetes(absoluteRoot, reader, signals);
  const githubActions = await detectGitHubActions(absoluteRoot, reader, signals);

  // 6. Monorepo.
  const { monorepo, workspacePackages } = await detectMonorepo(absoluteRoot, pkg, reader, signals);

  return {
    root: absoluteRoot,
    runtime,
    packageManager,
    typescript,
    linter,
    formatter,
    testRunner,
    orm,
    docker,
    kubernetes,
    githubActions,
    monorepo,
    workspacePackages,
    signals
  };
}

async function detectPackageManager(
  root: string,
  reader: FilesystemReader,
  signals: WorkspaceSignals
): Promise<PackageManager> {
  const candidates: Array<[PackageManager, string]> = [
    ["pnpm", "pnpm-lock.yaml"],
    ["yarn", "yarn.lock"],
    ["npm", "package-lock.json"],
    ["bun", "bun.lock"]
  ];
  for (const [pm, file] of candidates) {
    const exists = await reader.exists(path.join(root, file));
    if (exists) {
      signals.files[file] = true;
      signals.configFiles["lockfile"] = path.join(root, file);
      return pm;
    }
  }
  // Fallback: package.json `packageManager` field.
  const pkgRaw = await reader.readFile(path.join(root, "package.json"));
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as { packageManager?: string };
      if (pkg.packageManager) {
        const pmField = pkg.packageManager.toLowerCase();
        if (pmField.startsWith("pnpm@")) return "pnpm";
        if (pmField.startsWith("yarn@")) return "yarn";
        if (pmField.startsWith("npm@")) return "npm";
        if (pmField.startsWith("bun@")) return "bun";
      }
    } catch {
      // ignore — fall through
    }
    // No lockfile in repo (common in fixtures and new projects); npm is the default runner.
    return "npm";
  }
  return "unknown";
}

function detectRuntime(
  pkg: NormalizedPackageJson | undefined,
  packageManager: PackageManager,
  signals: WorkspaceSignals
): NodeRuntime {
  // Evidence order: engines.node → engines.bun → engines.deno → devDeps → packageManager
  const engines = pkg?.engines ?? {};
  if (engines.deno) {
    signals.files["engines.deno"] = true;
    return "deno";
  }
  if (engines.bun) {
    signals.files["engines.bun"] = true;
    return "bun";
  }
  if (engines.node) {
    signals.files["engines.node"] = true;
    return "node";
  }
  const devDeps = pkg?.devDependencies ?? {};
  if (devDeps["@types/deno"] || devDeps["deno"]) return "deno";
  if (devDeps["@types/bun"] || devDeps["bun"]) return "bun";

  // If we have a Node-only lockfile, assume Node.
  if (packageManager === "bun") {
    // bun.lock could be either Node or Bun; assume Bun only if engines say so.
    return "node";
  }
  // If package.json exists at all, default to node.
  return pkg ? "node" : "unknown";
}

async function detectTypeScript(
  root: string,
  pkg: NormalizedPackageJson | undefined,
  reader: FilesystemReader,
  signals: WorkspaceSignals
): Promise<boolean> {
  const tsconfigPath = path.join(root, "tsconfig.json");
  const exists = await reader.exists(tsconfigPath);
  if (exists) {
    signals.files["tsconfig.json"] = true;
    signals.configFiles["tsconfig"] = tsconfigPath;
    return true;
  }
  // Fallback: TypeScript in devDependencies.
  const devDeps = pkg?.devDependencies ?? {};
  if (devDeps["typescript"]) {
    signals.files["typescript-in-devDependencies"] = true;
    return true;
  }
  return false;
}

async function detectLinter(
  root: string,
  reader: FilesystemReader,
  signals: WorkspaceSignals
): Promise<"eslint" | "biome" | undefined> {
  const candidates = ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts"];
  for (const file of candidates) {
    if (await reader.exists(path.join(root, file))) {
      signals.files[file] = true;
      signals.configFiles["eslint"] = path.join(root, file);
      return "eslint";
    }
  }
  const biomeCandidates = ["biome.json", "biome.jsonc"];
  for (const file of biomeCandidates) {
    if (await reader.exists(path.join(root, file))) {
      signals.files[file] = true;
      signals.configFiles["biome"] = path.join(root, file);
      return "biome";
    }
  }
  return undefined;
}

async function detectFormatter(
  root: string,
  reader: FilesystemReader,
  signals: WorkspaceSignals
): Promise<"prettier" | "biome" | undefined> {
  const prettierCandidates = [
    ".prettierrc",
    ".prettierrc.json",
    ".prettierrc.yml",
    ".prettierrc.yaml",
    ".prettierrc.json5",
    ".prettierrc.js",
    ".prettierrc.cjs",
    ".prettierrc.mjs",
    ".prettierrc.toml",
    "prettier.config.js",
    "prettier.config.cjs",
    "prettier.config.mjs"
  ];
  for (const file of prettierCandidates) {
    if (await reader.exists(path.join(root, file))) {
      signals.files[file] = true;
      signals.configFiles["prettier"] = path.join(root, file);
      return "prettier";
    }
  }
  // Prettier can also be configured via package.json
  const pkgRaw = await reader.readFile(path.join(root, "package.json"));
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as { prettier?: unknown };
      if (pkg.prettier !== undefined) {
        signals.files["prettier-in-package.json"] = true;
        signals.configFiles["prettier"] = path.join(root, "package.json");
        return "prettier";
      }
    } catch {
      // ignore
    }
  }
  // Biome is also a formatter — if a biome config exists, formatter is "biome".
  if (await reader.exists(path.join(root, "biome.json"))) {
    signals.files["biome.json"] = true;
    signals.configFiles["biome"] = path.join(root, "biome.json");
    return "biome";
  }
  return undefined;
}

function detectTestRunner(
  pkg: NormalizedPackageJson | undefined,
  signals: WorkspaceSignals
): "vitest" | "jest" | "node" | "unknown" | undefined {
  if (!pkg) return undefined;
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const scripts = pkg.scripts ?? {};

  // Direct dependency check first.
  if (allDeps["vitest"]) {
    signals.files["vitest-in-deps"] = true;
    return "vitest";
  }
  if (allDeps["jest"]) {
    signals.files["jest-in-deps"] = true;
    return "jest";
  }
  // Node test runner: `node --test` in scripts, or no test runner installed but tests exist.
  if (scripts.test && /node\s+--test/.test(scripts.test)) {
    signals.files["node-test-in-scripts"] = true;
    return "node";
  }
  // Common script-name heuristic.
  if (scripts.test && scripts.test.includes("vitest")) return "vitest";
  if (scripts.test && scripts.test.includes("jest")) return "jest";
  return "unknown";
}

async function detectOrm(
  root: string,
  reader: FilesystemReader,
  signals: WorkspaceSignals
): Promise<"prisma" | "drizzle" | undefined> {
  const prismaDir = path.join(root, "prisma", "schema.prisma");
  if (await reader.exists(prismaDir)) {
    signals.files["prisma/schema.prisma"] = true;
    signals.configFiles["prisma"] = prismaDir;
    return "prisma";
  }
  const drizzleConfigs = ["drizzle.config.ts", "drizzle.config.js", "drizzle.config.mjs"];
  for (const file of drizzleConfigs) {
    if (await reader.exists(path.join(root, file))) {
      signals.files[file] = true;
      signals.configFiles["drizzle"] = path.join(root, file);
      return "drizzle";
    }
  }
  return undefined;
}

async function detectDocker(
  root: string,
  reader: FilesystemReader,
  signals: WorkspaceSignals
): Promise<boolean> {
  const dockerfile = path.join(root, "Dockerfile");
  const composeFiles = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];
  let found = false;
  if (await reader.exists(dockerfile)) {
    signals.files["Dockerfile"] = true;
    signals.configFiles["docker"] = dockerfile;
    found = true;
  }
  for (const file of composeFiles) {
    if (await reader.exists(path.join(root, file))) {
      signals.files[file] = true;
      signals.configFiles["docker-compose"] = path.join(root, file);
      found = true;
    }
  }
  return found;
}

async function detectKubernetes(
  root: string,
  reader: FilesystemReader,
  signals: WorkspaceSignals
): Promise<boolean> {
  const k8sDirs = ["k8s", ".k8s", "manifests", "kubernetes"];
  for (const dir of k8sDirs) {
    const entries = await reader.readDir(path.join(root, dir));
    if (entries.some((e) => e.endsWith(".yaml") || e.endsWith(".yml"))) {
      signals.files[`${dir}/`] = true;
      signals.configFiles["kubernetes"] = path.join(root, dir);
      return true;
    }
  }
  // kustomization.yaml at root
  if (await reader.exists(path.join(root, "kustomization.yaml"))) {
    signals.files["kustomization.yaml"] = true;
    signals.configFiles["kubernetes"] = path.join(root, "kustomization.yaml");
    return true;
  }
  return false;
}

async function detectGitHubActions(
  root: string,
  reader: FilesystemReader,
  signals: WorkspaceSignals
): Promise<boolean> {
  const workflowDir = path.join(root, ".github", "workflows");
  const entries = await reader.readDir(workflowDir);
  const hasWorkflows = entries.some((e) => e.endsWith(".yml") || e.endsWith(".yaml"));
  if (hasWorkflows) {
    signals.files[".github/workflows/"] = true;
    signals.configFiles["github-actions"] = workflowDir;
    return true;
  }
  return false;
}

async function detectMonorepo(
  root: string,
  pkg: NormalizedPackageJson | undefined,
  reader: FilesystemReader,
  signals: WorkspaceSignals
): Promise<{ monorepo: MonorepoKind; workspacePackages: string[] }> {
  // Always record the presence of these build-tool config files as signals,
  // even if they aren't the deciding factor for the monorepo kind.
  const hasPnpmWorkspace = await reader.exists(path.join(root, "pnpm-workspace.yaml"));
  if (hasPnpmWorkspace) {
    signals.files["pnpm-workspace.yaml"] = true;
    signals.configFiles["pnpm-workspace"] = path.join(root, "pnpm-workspace.yaml");
  }
  const hasTurboJson = await reader.exists(path.join(root, "turbo.json"));
  if (hasTurboJson) {
    signals.files["turbo.json"] = true;
    signals.configFiles["turbo"] = path.join(root, "turbo.json");
  }
  const hasNxJson = await reader.exists(path.join(root, "nx.json"));
  if (hasNxJson) {
    signals.files["nx.json"] = true;
    signals.configFiles["nx"] = path.join(root, "nx.json");
  }

  // Decide the monorepo kind. Workspace-manifest files take precedence over
  // build-tool files: pnpm-workspace.yaml is the source of truth for monorepo
  // structure even when turbo.json is present.
  if (hasPnpmWorkspace) {
    const workspaces = await listWorkspaceDirs(root, ["packages/*", "apps/*"], reader);
    return { monorepo: "pnpm", workspacePackages: workspaces };
  }

  if (pkg?.workspaces) {
    const patterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces.packages ?? []);
    signals.files["package.json#workspaces"] = true;
    const workspaces = await listWorkspaceDirs(root, patterns, reader);
    return { monorepo: "npm", workspacePackages: workspaces };
  }

  if (hasTurboJson) {
    const workspaces = await listWorkspaceDirs(root, ["packages/*", "apps/*"], reader);
    return { monorepo: "turborepo", workspacePackages: workspaces };
  }

  if (hasNxJson) {
    const workspaces = await listWorkspaceDirs(root, ["packages/*", "apps/*"], reader);
    return { monorepo: "nx", workspacePackages: workspaces };
  }

  return { monorepo: "none", workspacePackages: [] };
}

async function listWorkspaceDirs(
  root: string,
  patterns: string[],
  reader: FilesystemReader
): Promise<string[]> {
  const results: string[] = [];
  for (const pattern of patterns) {
    const matches = await reader.glob(pattern, root);
    for (const m of matches) {
      // Resolve to absolute path and deduplicate.
      const abs = path.join(root, m);
      if (!results.includes(abs)) results.push(abs);
    }
  }
  return results.sort();
}
