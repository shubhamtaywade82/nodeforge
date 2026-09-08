/**
 * Workspace profile — the result of running the detector over a project root.
 *
 * This is the entry-point contract for almost every other NodeForge subsystem:
 * adapters consult it to decide what to enable, the UI renders it in the
 * sidebar, and the agent reads it to understand project shape.
 */

export type NodeRuntime = "node" | "bun" | "deno" | "unknown";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun" | "unknown";

export type Linter = "eslint" | "biome";

export type Formatter = "prettier" | "biome";

export type TestRunner = "vitest" | "jest" | "node" | "unknown";

export type Orm = "prisma" | "drizzle";

export type MonorepoKind = "pnpm" | "npm" | "yarn" | "turborepo" | "nx" | "none";

/**
 * Detected workspace profile. All fields are populated by the detector and
 * treated as immutable by consumers.
 */
export interface WorkspaceProfile {
  /** Absolute path to the workspace root. */
  root: string;

  /** Detected JS runtime from `engines` field or lockfile heuristics. */
  runtime: NodeRuntime;

  /** Detected package manager from lockfiles. */
  packageManager: PackageManager;

  /** Whether TypeScript is present (tsconfig.json or @types/node in deps). */
  typescript: boolean;

  /** Detected linter, if any. */
  linter?: Linter;

  /** Detected formatter, if any. */
  formatter?: Formatter;

  /** Detected test runner, if any. */
  testRunner?: TestRunner;

  /** Detected ORM, if any. */
  orm?: Orm;

  /** Whether a Dockerfile or docker-compose.yml is present. */
  docker: boolean;

  /** Whether Kubernetes manifests (.k8s/, kustomization.yaml, etc.) are present. */
  kubernetes: boolean;

  /** Whether .github/workflows/* is present. */
  githubActions: boolean;

  /** Detected monorepo kind. */
  monorepo: MonorepoKind;

  /** Workspace package scopes discovered (e.g. apps/*, packages/*). */
  workspacePackages: string[];

  /** Raw signals used by the detector — useful for debugging the detector itself. */
  signals: WorkspaceSignals;
}

/**
 * Raw filesystem signals that the detector collected. Useful for the UI to
 * show "why was ESLint detected?" and for the agent to reason about evidence.
 */
export interface WorkspaceSignals {
  files: Record<string, boolean>;
  /** Inferred package.json `engines` fields, if present. */
  engines?: Record<string, string>;
  /** Top-level `scripts` from package.json, if present. */
  scripts?: Record<string, string>;
  /** Detected config file paths (absolute) keyed by tool name. */
  configFiles: Record<string, string>;
}
