/**
 * NodeForgeContext — the bridge between MCP tool handlers and the underlying
 * NodeForge adapters.
 *
 * The context reads the workspace root from the `NODEFORGE_WORKSPACE_ROOT`
 * environment variable (set by the MCP client / Cursor config). On first
 * access, it runs workspace detection to determine which adapters are
 * applicable. Subsequent tool calls re-use the detected profile.
 *
 * The context is intentionally stateless across tool calls — each `getX()`
 * method runs the relevant adapter fresh. This keeps the MCP server simple
 * (no caching, no invalidation logic) at the cost of repeated work. A future
 * version can add caching with file-watch invalidation.
 */

import { detectWorkspaceProfile, NodeFilesystemReader } from "@nodeforge/core";
import { ProcessRunner } from "@nodeforge/runner";
import { TypescriptAdapter } from "@nodeforge/adapter-typescript";
import { EslintAdapter } from "@nodeforge/adapter-eslint";
import { BiomeAdapter } from "@nodeforge/adapter-biome";
import { VitestAdapter } from "@nodeforge/adapter-vitest";
import { JestAdapter } from "@nodeforge/adapter-jest";
import { GitAdapter } from "@nodeforge/adapter-git";
import { PrismaAdapter } from "@nodeforge/adapter-prisma";
import { DrizzleAdapter } from "@nodeforge/adapter-drizzle";
import { DependencyAdapter } from "@nodeforge/adapter-dependencies";
import { DockerAdapter } from "@nodeforge/adapter-docker";
import { KubernetesAdapter } from "@nodeforge/adapter-kubernetes";
import { GitHubActionsAdapter } from "@nodeforge/adapter-github-actions";
import { DependencyGraphAdapter } from "@nodeforge/adapter-dependency-graph";
import type {
  DatabaseSchema,
  DependencyGraphAnalysis,
  DependencyReport,
  Diagnostic,
  DockerConfig,
  GitHubActionsConfig,
  GitState,
  KubernetesManifests,
  TestRunResult,
  TestSuite,
  WorkspaceProfile
} from "@nodeforge/contracts";

export class NodeForgeContext {
  private readonly runner: ProcessRunner;
  private readonly reader: NodeFilesystemReader;
  private profile: WorkspaceProfile | undefined;

  constructor(private readonly workspaceRoot: string) {
    this.runner = new ProcessRunner();
    this.reader = new NodeFilesystemReader();
  }

  /** Returns the workspace root this context was created for. */
  getRoot(): string {
    return this.workspaceRoot;
  }

  /** Detect the workspace profile. Cached after first call. */
  async getProfile(): Promise<WorkspaceProfile> {
    if (this.profile) return this.profile;
    this.profile = await detectWorkspaceProfile(this.workspaceRoot, this.reader);
    return this.profile;
  }

  /** Run TypeScript + ESLint/Biome diagnostics and return combined findings. */
  async getDiagnostics(): Promise<Diagnostic[]> {
    const profile = await this.getProfile();
    const diagnostics: Diagnostic[] = [];

    if (profile.typescript) {
      try {
        const result = await new TypescriptAdapter(this.runner).run(this.workspaceRoot);
        diagnostics.push(...result.diagnostics);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[nodeforge:mcp] TypeScript adapter failed", err);
      }
    }

    if (profile.linter === "eslint") {
      try {
        const result = await new EslintAdapter(this.runner).run(this.workspaceRoot);
        diagnostics.push(...result.diagnostics);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[nodeforge:mcp] ESLint adapter failed", err);
      }
    } else if (profile.linter === "biome") {
      try {
        const result = await new BiomeAdapter(this.runner).run(this.workspaceRoot);
        diagnostics.push(...result.diagnostics);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[nodeforge:mcp] Biome adapter failed", err);
      }
    }

    return diagnostics;
  }

  /** Run the detected test runner and return the suite + result. */
  async getTestResults(): Promise<{ suite: TestSuite; result: TestRunResult } | undefined> {
    const profile = await this.getProfile();
    if (profile.testRunner === "vitest") {
      const result = await new VitestAdapter(this.runner).run(this.workspaceRoot);
      return { suite: result.suite, result: result.result };
    }
    if (profile.testRunner === "jest") {
      const result = await new JestAdapter(this.runner).run(this.workspaceRoot);
      return { suite: result.suite, result: result.result };
    }
    return undefined;
  }

  /** Detect Git state. Returns undefined if not a git repo. */
  async getGitState(): Promise<GitState | undefined> {
    return new GitAdapter(this.runner).detect(this.workspaceRoot);
  }

  /** Run dependency audit + outdated. */
  async getDependencyReport(): Promise<DependencyReport | undefined> {
    const profile = await this.getProfile();
    const pm =
      profile.packageManager === "npm" || profile.packageManager === "pnpm" || profile.packageManager === "yarn"
        ? profile.packageManager
        : "npm";
    const adapter = new DependencyAdapter(this.runner, { packageManager: pm });
    try {
      const result = await adapter.run(this.workspaceRoot);
      let outdated: DependencyReport["outdated"] = [];
      try {
        outdated = await adapter.outdated(this.workspaceRoot);
      } catch {
        // best-effort
      }
      return { ...result.report, outdated };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[nodeforge:mcp] dependency audit failed", err);
      return undefined;
    }
  }

  /** Detect database schema (Prisma or Drizzle). */
  async getDatabaseSchema(): Promise<DatabaseSchema | undefined> {
    const profile = await this.getProfile();
    if (profile.orm === "prisma") {
      try {
        return await new PrismaAdapter().detect(this.workspaceRoot);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[nodeforge:mcp] Prisma detect failed", err);
        return undefined;
      }
    }
    if (profile.orm === "drizzle") {
      try {
        return await new DrizzleAdapter().detect(this.workspaceRoot);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[nodeforge:mcp] Drizzle detect failed", err);
        return undefined;
      }
    }
    return undefined;
  }

  /** Run only the linter (ESLint or Biome), not TypeScript. */
  async runLinter(): Promise<Diagnostic[]> {
    const profile = await this.getProfile();
    if (profile.linter === "eslint") {
      const result = await new EslintAdapter(this.runner).run(this.workspaceRoot);
      return result.diagnostics;
    }
    if (profile.linter === "biome") {
      const result = await new BiomeAdapter(this.runner).run(this.workspaceRoot);
      return result.diagnostics;
    }
    return [];
  }

  /** Run only the type checker (tsc --noEmit). */
  async runTypeCheck(): Promise<Diagnostic[]> {
    const profile = await this.getProfile();
    if (!profile.typescript) return [];
    const result = await new TypescriptAdapter(this.runner).run(this.workspaceRoot);
    return result.diagnostics;
  }

  /** Run tests and return the result. */
  async runTests(): Promise<{ suite: TestSuite; result: TestRunResult } | undefined> {
    return this.getTestResults();
  }

  /** Detect Docker configuration (Dockerfile + docker-compose.yml). */
  async getDockerConfig(): Promise<DockerConfig | undefined> {
    try {
      return await new DockerAdapter().detect(this.workspaceRoot);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[nodeforge:mcp] Docker detect failed", err);
      return undefined;
    }
  }

  /** Detect Kubernetes manifests in standard scan directories. */
  async getKubernetesManifests(): Promise<KubernetesManifests | undefined> {
    try {
      const result = await new KubernetesAdapter().detect(this.workspaceRoot);
      if (result.resources.length === 0) return undefined;
      return result;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[nodeforge:mcp] Kubernetes detect failed", err);
      return undefined;
    }
  }

  /** Detect GitHub Actions workflows in .github/workflows/. */
  async getGitHubWorkflows(): Promise<GitHubActionsConfig | undefined> {
    try {
      const result = await new GitHubActionsAdapter().detect(this.workspaceRoot);
      if (result.workflows.length === 0) return undefined;
      return result;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[nodeforge:mcp] GitHub Actions detect failed", err);
      return undefined;
    }
  }

  /** Analyze the dependency graph (unused deps, circular deps, missing deps). */
  async getDependencyGraph(): Promise<DependencyGraphAnalysis | undefined> {
    try {
      return await new DependencyGraphAdapter().analyze(this.workspaceRoot);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[nodeforge:mcp] dependency graph analysis failed", err);
      return undefined;
    }
  }
}

/**
 * Create a NodeForgeContext from the environment.
 *
 * Resolution order for the workspace root:
 *   1. `NODEFORGE_WORKSPACE_ROOT` env var (set by Cursor's MCP config)
 *   2. `process.cwd()` (fallback for manual invocation)
 */
export function createContextFromEnv(): NodeForgeContext {
  const root = process.env.NODEFORGE_WORKSPACE_ROOT ?? process.cwd();
  return new NodeForgeContext(root);
}
