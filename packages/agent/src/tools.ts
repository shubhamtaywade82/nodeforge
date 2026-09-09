/**
 * MCP tool definitions for NodeForge.
 *
 * Each tool has:
 *   - name: the tool identifier (e.g. "getProjectContext")
 *   - description: what the tool does (shown to the AI agent)
 *   - inputSchema: JSON Schema for the tool's arguments
 *   - handler: async function that takes args + context and returns a result
 *
 * The result is always a string (MCP convention) — we JSON.stringify structured
 * data so the agent can parse it.
 */

import type { NodeForgeContext } from "./NodeForgeContext.js";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpToolHandler {
  (args: Record<string, unknown>, context: NodeForgeContext): Promise<string>;
}

export interface McpTool {
  definition: McpToolDefinition;
  handler: McpToolHandler;
}

/** All tools exposed by the NodeForge MCP server. */
export const TOOLS: McpTool[] = [
  {
    definition: {
      name: "getProjectContext",
      description:
        "Get the NodeForge workspace profile: runtime, package manager, TypeScript presence, linter, formatter, test runner, ORM, Docker/K8s/GitHub Actions presence, and monorepo kind. Run this first to understand what the project is.",
      inputSchema: { type: "object", properties: {} }
    },
    handler: async (_args, ctx) => {
      const profile = await ctx.getProfile();
      return JSON.stringify(profile, null, 2);
    }
  },
  {
    definition: {
      name: "getDiagnostics",
      description:
        "Run TypeScript + ESLint/Biome diagnostics and return all findings as a JSON array. Each finding has source, severity, file, line, column, message, rule, and fixable flag.",
      inputSchema: { type: "object", properties: {} }
    },
    handler: async (_args, ctx) => {
      const diagnostics = await ctx.getDiagnostics();
      return JSON.stringify(diagnostics, null, 2);
    }
  },
  {
    definition: {
      name: "runTypeCheck",
      description:
        "Run only the TypeScript compiler (tsc --noEmit) and return type errors as a JSON array. Use this when you only care about type errors, not lint warnings.",
      inputSchema: { type: "object", properties: {} }
    },
    handler: async (_args, ctx) => {
      const diagnostics = await ctx.runTypeCheck();
      return JSON.stringify(diagnostics, null, 2);
    }
  },
  {
    definition: {
      name: "runLinter",
      description:
        "Run only the linter (ESLint or Biome, whichever is detected) and return lint findings as a JSON array. Does not run the TypeScript compiler.",
      inputSchema: { type: "object", properties: {} }
    },
    handler: async (_args, ctx) => {
      const diagnostics = await ctx.runLinter();
      return JSON.stringify(diagnostics, null, 2);
    }
  },
  {
    definition: {
      name: "getTestResults",
      description:
        "Run the detected test runner (Vitest or Jest) and return the test suite tree + run result. Includes pass/fail counts, durations, and failure messages.",
      inputSchema: { type: "object", properties: {} }
    },
    handler: async (_args, ctx) => {
      const outcome = await ctx.getTestResults();
      if (!outcome) {
        return JSON.stringify({ error: "No test runner detected (expected Vitest or Jest)." });
      }
      return JSON.stringify(outcome, null, 2);
    }
  },
  {
    definition: {
      name: "runTests",
      description:
        "Alias for getTestResults. Runs the detected test runner and returns the suite + result.",
      inputSchema: { type: "object", properties: {} }
    },
    handler: async (_args, ctx) => {
      const outcome = await ctx.runTests();
      if (!outcome) {
        return JSON.stringify({ error: "No test runner detected." });
      }
      return JSON.stringify(outcome, null, 2);
    }
  },
  {
    definition: {
      name: "getGitState",
      description:
        "Detect Git state: current branch, HEAD short hash, dirty status, changed files, staged files, upstream, and ahead/behind counts. Returns undefined if not a git repo.",
      inputSchema: { type: "object", properties: {} }
    },
    handler: async (_args, ctx) => {
      const state = await ctx.getGitState();
      return JSON.stringify(state ?? { error: "Not a git repository." }, null, 2);
    }
  },
  {
    definition: {
      name: "getDependencyReport",
      description:
        "Run npm/pnpm/yarn audit + outdated and return the combined report. Includes vulnerabilities (with severity, advisory IDs, recommended fixes) and outdated packages (with current/wanted/latest versions).",
      inputSchema: { type: "object", properties: {} }
    },
    handler: async (_args, ctx) => {
      const report = await ctx.getDependencyReport();
      if (!report) {
        return JSON.stringify({ error: "Dependency audit failed (no lockfile or package manager)." });
      }
      return JSON.stringify(report, null, 2);
    }
  },
  {
    definition: {
      name: "getDatabaseSchema",
      description:
        "Detect the database schema (Prisma or Drizzle) and return tables, columns, indexes, and relations. Returns undefined if no ORM is detected.",
      inputSchema: { type: "object", properties: {} }
    },
    handler: async (_args, ctx) => {
      const schema = await ctx.getDatabaseSchema();
      if (!schema) {
        return JSON.stringify({ error: "No ORM detected (expected Prisma or Drizzle)." });
      }
      return JSON.stringify(schema, null, 2);
    }
  },
  {
    definition: {
      name: "getDockerConfig",
      description:
        "Detect Docker configuration: parses Dockerfile (base image, stages, env, ports, healthcheck) and docker-compose.yml (services, ports, volumes, networks, depends_on). Returns undefined if no Docker files exist.",
      inputSchema: { type: "object", properties: {} }
    },
    handler: async (_args, ctx) => {
      const config = await ctx.getDockerConfig();
      if (!config || (!config.dockerfile && !config.compose)) {
        return JSON.stringify({ error: "No Docker configuration detected (no Dockerfile or docker-compose.yml)." });
      }
      return JSON.stringify(config, null, 2);
    }
  },
  {
    definition: {
      name: "getKubernetesManifests",
      description:
        "Detect Kubernetes manifests in standard directories (k8s/, .k8s/, manifests/, kubernetes/). Returns Deployments, Services, ConfigMaps, Secrets, Ingresses with full spec (containers, ports, env, resources, probes). Returns undefined if no manifests found.",
      inputSchema: { type: "object", properties: {} }
    },
    handler: async (_args, ctx) => {
      const manifests = await ctx.getKubernetesManifests();
      if (!manifests) {
        return JSON.stringify({ error: "No Kubernetes manifests detected." });
      }
      return JSON.stringify(manifests, null, 2);
    }
  },
  {
    definition: {
      name: "getGitHubWorkflows",
      description:
        "Detect GitHub Actions workflows in .github/workflows/. Returns each workflow with triggers (push/pull_request/schedule/workflow_dispatch), jobs, steps, matrix strategy, env, concurrency, and permissions. Returns undefined if no workflows found.",
      inputSchema: { type: "object", properties: {} }
    },
    handler: async (_args, ctx) => {
      const config = await ctx.getGitHubWorkflows();
      if (!config) {
        return JSON.stringify({ error: "No GitHub Actions workflows detected." });
      }
      return JSON.stringify(config, null, 2);
    }
  },
  {
    definition: {
      name: "getDependencyGraph",
      description:
        "Analyze the dependency graph: scans all source files for import/require statements, builds the import graph, and detects unused dependencies (declared but never imported), circular dependencies (import cycles), and missing dependencies (imported but not declared). Returns the full graph + analysis.",
      inputSchema: { type: "object", properties: {} }
    },
    handler: async (_args, ctx) => {
      const analysis = await ctx.getDependencyGraph();
      if (!analysis) {
        return JSON.stringify({ error: "Dependency graph analysis failed (no package.json or source files)." });
      }
      return JSON.stringify(analysis, null, 2);
    }
  }
];

/** Look up a tool by name. */
export function findTool(name: string): McpTool | undefined {
  return TOOLS.find((t) => t.definition.name === name);
}

/** Return all tool definitions (for the tools/list response). */
export function listToolDefinitions(): McpToolDefinition[] {
  return TOOLS.map((t) => t.definition);
}
