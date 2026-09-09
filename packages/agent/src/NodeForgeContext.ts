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

import * as path from "node:path";
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
import { PrettierAdapter } from "@nodeforge/adapter-prettier";
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

  // ─── Action tools (write operations) ───

  /**
   * Read a config file from the workspace and return its contents.
   * Used by the MCP resources/read handler.
   */
  async readConfigFile(filePath: string): Promise<string | undefined> {
    const fs = await import("node:fs/promises");
    const abs = path.isAbsolute(filePath) ? filePath : path.join(this.workspaceRoot, filePath);
    try {
      return await fs.readFile(abs, "utf8");
    } catch {
      return undefined;
    }
  }

  /**
   * List all config files in the workspace that NodeForge can expose as
   * MCP resources.
   */
  async listConfigFiles(): Promise<Array<{ path: string; description: string }>> {
    const fs = await import("node:fs/promises");
    const candidates: Array<{ name: string; description: string }> = [
      { name: "package.json", description: "Node.js package manifest with dependencies and scripts" },
      { name: "tsconfig.json", description: "TypeScript compiler configuration" },
      { name: "eslint.config.mjs", description: "ESLint flat config" },
      { name: "eslint.config.js", description: "ESLint flat config" },
      { name: "eslint.config.cjs", description: "ESLint flat config" },
      { name: "biome.json", description: "Biome linter/formatter configuration" },
      { name: ".prettierrc.json", description: "Prettier formatter configuration" },
      { name: ".prettierrc", description: "Prettier formatter configuration" },
      { name: "vitest.config.ts", description: "Vitest test runner configuration" },
      { name: "vitest.config.js", description: "Vitest test runner configuration" },
      { name: "jest.config.js", description: "Jest test runner configuration" },
      { name: "jest.config.ts", description: "Jest test runner configuration" },
      { name: "drizzle.config.ts", description: "Drizzle ORM configuration" },
      { name: "drizzle.config.js", description: "Drizzle ORM configuration" },
      { name: "Dockerfile", description: "Docker build instructions" },
      { name: "docker-compose.yml", description: "Docker Compose service definitions" },
      { name: "docker-compose.yaml", description: "Docker Compose service definitions" },
      { name: ".env", description: "Environment variables (may contain secrets)" },
      { name: ".env.local", description: "Local environment variables (may contain secrets)" },
      { name: ".editorconfig", description: "Editor configuration for consistent formatting" },
      { name: ".gitignore", description: "Git ignore patterns" },
      { name: "README.md", description: "Project documentation" }
    ];

    const results: Array<{ path: string; description: string }> = [];
    for (const c of candidates) {
      try {
        await fs.access(path.join(this.workspaceRoot, c.name));
        results.push({ path: c.name, description: c.description });
      } catch {
        // file doesn't exist — skip
      }
    }
    return results;
  }

  // ─── Action tools (write operations) ───

  /**
   * Run a script from package.json (`npm run <script>`, `pnpm run <script>`,
   * or `yarn <script>` depending on the detected package manager).
   *
   * Returns stdout, stderr, exit code, and duration.
   */
  async runScript(
    scriptName: string,
    args: string[] = []
  ): Promise<{
    script: string;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    durationMs: number;
  }> {
    const profile = await this.getProfile();
    const pm = profile.packageManager === "pnpm" ? "pnpm" : profile.packageManager === "yarn" ? "yarn" : "npm";
    // For npm/pnpm: `run <script>`. For yarn: `<script>` (no `run` needed for most scripts).
    const pmArgs = pm === "yarn" ? [scriptName, ...args] : ["run", scriptName, ...args];

    const result = await this.runner.run({
      command: pm,
      args: pmArgs,
      cwd: this.workspaceRoot,
      timeoutMs: 120_000
    });

    return {
      script: scriptName,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs
    };
  }

  /**
   * Format files using the detected formatter (Prettier or Biome).
   *
   * If the workspace uses Biome as its formatter, runs `biome format --write`.
   * Otherwise, if a Prettier config exists, runs `prettier --write`.
   *
   * Returns the number of files formatted and the raw output.
   */
  async formatFiles(): Promise<{
    formatter: "prettier" | "biome" | "none";
    filesFormatted: number;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    durationMs: number;
  }> {
    const profile = await this.getProfile();

    if (profile.formatter === "biome") {
      try {
        const adapter = new BiomeAdapter(this.runner);
        const result = await adapter.format(this.workspaceRoot);
        return {
          formatter: "biome",
          filesFormatted: result.filesFormatted,
          stdout: result.rawStdout,
          stderr: result.rawStderr,
          exitCode: result.exitCode,
          durationMs: result.durationMs
        };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[nodeforge:mcp] Biome format failed", err);
        return {
          formatter: "biome",
          filesFormatted: 0,
          stdout: "",
          stderr: err instanceof Error ? err.message : String(err),
          exitCode: null,
          durationMs: 0
        };
      }
    }

    // Try Prettier
    const hasPrettier = await PrettierAdapter.hasConfig(this.workspaceRoot);
    if (hasPrettier) {
      try {
        const adapter = new PrettierAdapter(this.runner);
        const result = await adapter.format(this.workspaceRoot);
        return {
          formatter: "prettier",
          filesFormatted: result.filesFormatted,
          stdout: result.rawStdout,
          stderr: result.rawStderr,
          exitCode: result.exitCode,
          durationMs: result.durationMs
        };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[nodeforge:mcp] Prettier format failed", err);
        return {
          formatter: "prettier",
          filesFormatted: 0,
          stdout: "",
          stderr: err instanceof Error ? err.message : String(err),
          exitCode: null,
          durationMs: 0
        };
      }
    }

    return {
      formatter: "none",
      filesFormatted: 0,
      stdout: "",
      stderr: "No formatter detected (expected Prettier or Biome).",
      exitCode: null,
      durationMs: 0
    };
  }

  /**
   * Run ESLint with `--fix` to auto-fix lint issues.
   *
   * Returns the diagnostics remaining after the fix (i.e., issues that
   * couldn't be auto-fixed).
   */
  async applyEslintFix(): Promise<{
    fixed: boolean;
    remainingDiagnostics: Diagnostic[];
    stdout: string;
    stderr: string;
    exitCode: number | null;
    durationMs: number;
  }> {
    const profile = await this.getProfile();
    if (profile.linter !== "eslint") {
      return {
        fixed: false,
        remainingDiagnostics: [],
        stdout: "",
        stderr: "ESLint is not the detected linter for this workspace.",
        exitCode: null,
        durationMs: 0
      };
    }

    try {
      const adapter = new EslintAdapter(this.runner);
      const result = await adapter.fix(this.workspaceRoot);
      return {
        fixed: true,
        remainingDiagnostics: result.diagnostics,
        stdout: result.rawStdout,
        stderr: result.rawStderr,
        exitCode: result.exitCode,
        durationMs: result.durationMs
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[nodeforge:mcp] ESLint --fix failed", err);
      return {
        fixed: false,
        remainingDiagnostics: [],
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        exitCode: null,
        durationMs: 0
      };
    }
  }

  /**
   * Run a comprehensive validation: typecheck + lint + tests + audit.
   * Returns a combined report with pass/fail status for each stage.
   */
  async validateWorkspace(): Promise<{
    typecheck: { passed: boolean; errorCount: number; durationMs: number };
    lint: { passed: boolean; errorCount: number; warningCount: number; durationMs: number };
    tests: { passed: boolean; passedCount: number; failedCount: number; durationMs: number } | undefined;
    audit: { passed: boolean; vulnerabilityCount: number; durationMs: number } | undefined;
    overallPassed: boolean;
  }> {
    const profile = await this.getProfile();
    const results: Awaited<ReturnType<typeof this.validateWorkspace>> = {
      typecheck: { passed: true, errorCount: 0, durationMs: 0 },
      lint: { passed: true, errorCount: 0, warningCount: 0, durationMs: 0 },
      tests: undefined,
      audit: undefined,
      overallPassed: true
    };

    // Type check
    if (profile.typescript) {
      const start = Date.now();
      try {
        const diagnostics = await this.runTypeCheck();
        const errors = diagnostics.filter((d) => d.severity === "error");
        results.typecheck = {
          passed: errors.length === 0,
          errorCount: errors.length,
          durationMs: Date.now() - start
        };
      } catch {
        results.typecheck = { passed: false, errorCount: -1, durationMs: Date.now() - start };
      }
    }

    // Lint
    if (profile.linter) {
      const start = Date.now();
      try {
        const diagnostics = await this.runLinter();
        const errors = diagnostics.filter((d) => d.severity === "error");
        const warnings = diagnostics.filter((d) => d.severity === "warning");
        results.lint = {
          passed: errors.length === 0,
          errorCount: errors.length,
          warningCount: warnings.length,
          durationMs: Date.now() - start
        };
      } catch {
        results.lint = { passed: false, errorCount: -1, warningCount: 0, durationMs: Date.now() - start };
      }
    }

    // Tests
    if (profile.testRunner === "vitest" || profile.testRunner === "jest") {
      const start = Date.now();
      try {
        const outcome = await this.runTests();
        if (outcome) {
          results.tests = {
            passed: outcome.result.counts.failed === 0,
            passedCount: outcome.result.counts.passed,
            failedCount: outcome.result.counts.failed,
            durationMs: Date.now() - start
          };
        }
      } catch {
        results.tests = { passed: false, passedCount: 0, failedCount: -1, durationMs: Date.now() - start };
      }
    }

    // Audit
    try {
      const start = Date.now();
      const report = await this.getDependencyReport();
      if (report) {
        results.audit = {
          passed: report.findings.length === 0,
          vulnerabilityCount: report.findings.length,
          durationMs: Date.now() - start
        };
      }
    } catch {
      // audit is optional — don't fail the overall validation
    }

    results.overallPassed =
      results.typecheck.passed &&
      results.lint.passed &&
      (results.tests === undefined || results.tests.passed);

    return results;
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
