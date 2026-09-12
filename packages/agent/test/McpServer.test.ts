/**
 * Tests for the MCP server — JSON-RPC message handling and tool dispatch.
 *
 * These tests use the real `node-ts-with-errors` fixture so tool handlers
 * actually run adapters and return real diagnostics / test results.
 */

import * as path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

import { McpServer } from "../src/McpServer.js";
import { NodeForgeContext } from "../src/NodeForgeContext.js";
import { TOOLS, findTool, listToolDefinitions } from "../src/tools.js";
import { PROMPTS } from "../src/prompts.js";

const FIXTURE = path.resolve(__dirname, "../../test-fixtures/node-ts-docker");

function makeServer(): McpServer {
  const ctx = new NodeForgeContext(FIXTURE);
  return new McpServer(ctx);
}

describe("McpServer protocol", () => {
  it("responds to initialize with server info + capabilities", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {}
    });

    expect(response).toBeDefined();
    expect(response!.jsonrpc).toBe("2.0");
    expect(response!.id).toBe(1);
    expect(response!.result).toBeDefined();
    const result = response!.result as {
      protocolVersion: string;
      capabilities: { tools: { listChanged: boolean } };
      serverInfo: { name: string; version: string };
    };
    expect(result.protocolVersion).toBe("2024-11-05");
    expect(result.capabilities.tools).toBeDefined();
    expect(result.serverInfo.name).toBe("nodeforge-mcp");
    expect(result.serverInfo.version).toBe("0.0.1");
  });

  it("responds to ping with empty result", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "ping"
    });
    expect(response!.id).toBe(2);
    expect(response!.result).toEqual({});
  });

  it("responds to tools/list with all tool definitions", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/list"
    });
    const result = response!.result as { tools: Array<{ name: string; description: string; inputSchema: unknown }> };
    expect(result.tools.length).toBeGreaterThanOrEqual(17);
    const names = result.tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "getProjectContext",
        "getDiagnostics",
        "runTypeCheck",
        "runLinter",
        "getTestResults",
        "runTests",
        "getGitState",
        "getDependencyReport",
        "getDatabaseSchema",
        "getDockerConfig",
        "getKubernetesManifests",
        "getGitHubWorkflows",
        "getDependencyGraph",
        "runScript",
        "formatFiles",
        "applyEslintFix",
        "validateWorkspace"
      ])
    );
  });

  it("returns method-not-found error for unknown methods", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "completely/unknown/method"
    });
    expect(response!.error).toBeDefined();
    expect(response!.error!.code).toBe(-32601);
    expect(response!.error!.message).toContain("Method not found");
  });

  it("does not respond to notifications", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      method: "notifications/initialized"
    });
    expect(response).toBeUndefined();
  });

  it("returns error for unknown tool", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "nonexistentTool", arguments: {} }
    });
    expect(response!.error).toBeDefined();
    expect(response!.error!.code).toBe(-32602);
    expect(response!.error!.message).toContain("Unknown tool");
  });

  it("returns error for missing tool name", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { arguments: {} }
    });
    expect(response!.error).toBeDefined();
    expect(response!.error!.code).toBe(-32602);
    expect(response!.error!.message).toContain("Invalid params");
  });

  it("responds to resources/list with config files", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 30,
      method: "resources/list"
    });
    const result = response!.result as {
      resources: Array<{ uri: string; name: string; description: string; mimeType: string }>;
    };
    expect(result.resources.length).toBeGreaterThan(0);
    // The docker fixture has package.json, tsconfig.json, Dockerfile, docker-compose.yml, .github/workflows/
    const names = result.resources.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(["package.json", "tsconfig.json", "Dockerfile", "docker-compose.yml"]));
    // Check URI format
    expect(result.resources[0]!.uri).toMatch(/^file:\/\//);
    expect(result.resources[0]!.mimeType).toBe("text/plain");
  });

  it("responds to resources/read with file contents", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 31,
      method: "resources/read",
      params: { uri: "file:///package.json" }
    });
    const result = response!.result as {
      contents: Array<{ uri: string; mimeType: string; text: string }>;
    };
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]!.uri).toBe("file:///package.json");
    expect(result.contents[0]!.mimeType).toBe("text/plain");
    // The text should be the package.json content
    const pkg = JSON.parse(result.contents[0]!.text) as { name: string };
    expect(pkg.name).toBe("fixture-node-ts-docker");
  });

  it("returns error for resources/read with missing file", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 32,
      method: "resources/read",
      params: { uri: "file:///nonexistent.json" }
    });
    expect(response!.error).toBeDefined();
    expect(response!.error!.message).toContain("Resource not found");
  });

  it("responds to prompts/list with available prompts", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 33,
      method: "prompts/list"
    });
    const result = response!.result as {
      prompts: Array<{ name: string; description: string }>;
    };
    expect(result.prompts.length).toBeGreaterThanOrEqual(5);
    const names = result.prompts.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining([
      "fix-lint-errors",
      "audit-and-upgrade-deps",
      "validate-and-fix",
      "onboard-to-project",
      "add-test-for",
      "explain-errors"
    ]));
  });

  it("responds to prompts/get with rendered message", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 34,
      method: "prompts/get",
      params: { name: "add-test-for", arguments: { filePath: "src/index.ts" } }
    });
    const result = response!.result as {
      description: string;
      messages: Array<{ role: string; content: { type: string; text: string } }>;
    };
    expect(result.description).toBeDefined();
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.role).toBe("user");
    // The {{filePath}} placeholder should be substituted
    expect(result.messages[0]!.content.text).toContain("src/index.ts");
    expect(result.messages[0]!.content.text).not.toContain("{{filePath}}");
  });

  it("returns error for prompts/get with unknown prompt", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 35,
      method: "prompts/get",
      params: { name: "nonexistent-prompt" }
    });
    expect(response!.error).toBeDefined();
    expect(response!.error!.message).toContain("Unknown prompt");
  });
});

describe("McpServer tool dispatch (real adapter runs)", () => {
  it("getProjectContext returns the workspace profile", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: { name: "getProjectContext", arguments: {} }
    });

    const result = response!.result as { content: Array<{ type: string; text: string }> };
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("text");

    const profile = JSON.parse(result.content[0]!.text) as {
      runtime: string;
      packageManager: string;
      typescript: boolean;
      linter?: string;
      docker: boolean;
      githubActions: boolean;
    };
    expect(profile.runtime).toBe("node");
    expect(profile.typescript).toBe(true);
    expect(profile.linter).toBe("eslint");
    expect(profile.docker).toBe(true);
    expect(profile.githubActions).toBe(true);
  });

  it("getDiagnostics returns diagnostic findings", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: { name: "getDiagnostics", arguments: {} }
    });

    const result = response!.result as { content: Array<{ type: string; text: string }> };
    const diagnostics = JSON.parse(result.content[0]!.text) as Array<{
      source: string;
      severity: string;
      file: string;
      message: string;
    }>;

    // The fixture is clean, so diagnostics may be empty or contain only minor findings.
    // What matters is that the tool returns a valid array.
    expect(Array.isArray(diagnostics)).toBe(true);
  });

  it("runTypeCheck returns only TypeScript findings", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: { name: "runTypeCheck", arguments: {} }
    });

    const result = response!.result as { content: Array<{ text: string }> };
    const diagnostics = JSON.parse(result.content[0]!.text) as Array<{ source: string }>;
    // All findings (if any) should be from TypeScript.
    for (const d of diagnostics) {
      expect(d.source).toBe("typescript");
    }
  });

  it("runLinter returns only ESLint findings", async () => {
    const eslintBin = path.join(FIXTURE, "node_modules", ".bin", "eslint");
    try {
      await fs.access(eslintBin);
    } catch {
      console.warn(`[nodeforge:test] skipping runLinter MCP test — eslint missing at ${eslintBin}`);
      return;
    }

    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: { name: "runLinter", arguments: {} }
    });

    const result = response!.result as { content: Array<{ text: string }> };
    const diagnostics = JSON.parse(result.content[0]!.text) as Array<{ source: string }>;
    // All findings (if any) should be from ESLint.
    for (const d of diagnostics) {
      expect(d.source).toBe("eslint");
    }
  });

  it("getGitState returns git info (or error for non-git dirs)", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 14,
      method: "tools/call",
      params: { name: "getGitState", arguments: {} }
    });

    const result = response!.result as { content: Array<{ text: string }> };
    const parsed = JSON.parse(result.content[0]!.text) as { error?: string; branch?: string };
    // The fixture is inside the nodeforge git repo, so we expect a real state.
    // If not in a git repo, we'd get { error: "Not a git repository." }.
    if (parsed.error) {
      expect(parsed.error).toContain("Not a git repository");
    } else {
      expect(parsed.branch).toBeDefined();
    }
  });

  it("getDatabaseSchema returns error when no ORM is detected", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 15,
      method: "tools/call",
      params: { name: "getDatabaseSchema", arguments: {} }
    });

    const result = response!.result as { content: Array<{ text: string }> };
    const parsed = JSON.parse(result.content[0]!.text) as { error?: string };
    expect(parsed.error).toContain("No ORM detected");
  });

  it("getDockerConfig returns Docker config from the fixture", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 16,
      method: "tools/call",
      params: { name: "getDockerConfig", arguments: {} }
    });

    const result = response!.result as { content: Array<{ text: string }> };
    const config = JSON.parse(result.content[0]!.text) as {
      dockerfile?: { baseImage: { baseImage: string; tag: string } };
      compose?: { services: Array<{ name: string }> };
    };
    expect(config.dockerfile).toBeDefined();
    expect(config.dockerfile!.baseImage.baseImage).toBe("node");
    expect(config.dockerfile!.baseImage.tag).toBe("20-slim");
    expect(config.compose).toBeDefined();
    expect(config.compose!.services.length).toBe(3);
  });

  it("getKubernetesManifests returns k8s resources from the fixture", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 17,
      method: "tools/call",
      params: { name: "getKubernetesManifests", arguments: {} }
    });

    const result = response!.result as { content: Array<{ text: string }> };
    const manifests = JSON.parse(result.content[0]!.text) as {
      resources: Array<{ kind: string; name: string }>;
    };
    expect(manifests.resources.length).toBeGreaterThanOrEqual(5);
    const kinds = manifests.resources.map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(["Deployment", "Service", "ConfigMap", "Secret", "Ingress"]));
  });

  it("getGitHubWorkflows returns workflows from the fixture", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 18,
      method: "tools/call",
      params: { name: "getGitHubWorkflows", arguments: {} }
    });

    const result = response!.result as { content: Array<{ text: string }> };
    const config = JSON.parse(result.content[0]!.text) as {
      workflows: Array<{ name: string; triggers: Array<{ kind: string }> }>;
    };
    expect(config.workflows.length).toBe(2);
    const ci = config.workflows.find((w) => w.name === "CI");
    expect(ci).toBeDefined();
    expect(ci!.triggers.length).toBe(3);
    const release = config.workflows.find((w) => w.name === "Release");
    expect(release).toBeDefined();
  });

  it("getDependencyGraph returns graph with unused + circular deps", async () => {
    // Use the depgraph fixture which has deliberate unused + circular deps.
    const depgraphFixture = path.resolve(__dirname, "../../test-fixtures/node-ts-depgraph");
    const ctx = new NodeForgeContext(depgraphFixture);
    const server = new McpServer(ctx);
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 19,
      method: "tools/call",
      params: { name: "getDependencyGraph", arguments: {} }
    });

    const result = response!.result as { content: Array<{ text: string }> };
    const analysis = JSON.parse(result.content[0]!.text) as {
      graph: { nodes: Array<{ kind: string }>; edges: unknown[] };
      unused: Array<{ packageName: string; likelyFalsePositive: boolean }>;
      circular: Array<{ chain: string[]; length: number }>;
      missing: unknown[];
    };

    // The fixture has source files and declared packages.
    expect(analysis.graph.nodes.length).toBeGreaterThan(0);
    expect(analysis.graph.edges.length).toBeGreaterThan(0);

    // `lodash` is declared but never imported → unused, not false positive.
    const lodash = analysis.unused.find((u) => u.packageName === "lodash");
    expect(lodash).toBeDefined();
    expect(lodash!.likelyFalsePositive).toBe(false);

    // `typescript` is a false positive (dev tool, not directly imported).
    const ts = analysis.unused.find((u) => u.packageName === "typescript");
    expect(ts).toBeDefined();
    expect(ts!.likelyFalsePositive).toBe(true);

    // The fixture has a circular dependency: a → b → c → a.
    expect(analysis.circular.length).toBeGreaterThanOrEqual(1);
  });

  it("runScript executes a package.json script", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: { name: "runScript", arguments: { script: "typecheck" } }
    });

    const result = response!.result as { content: Array<{ text: string }> };
    const scriptResult = JSON.parse(result.content[0]!.text) as {
      script: string;
      exitCode: number | null;
      stdout: string;
    };

    expect(scriptResult.script).toBe("typecheck");
    expect(scriptResult.exitCode).toBe(0); // tsc --noEmit on clean fixture
  });

  it("runScript returns error for missing script parameter", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: { name: "runScript", arguments: {} }
    });

    const result = response!.result as { content: Array<{ text: string }> };
    const parsed = JSON.parse(result.content[0]!.text) as { error: string };
    expect(parsed.error).toContain("Missing required parameter: script");
  });

  it("validateWorkspace runs typecheck + lint and returns overall status", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 22,
      method: "tools/call",
      params: { name: "validateWorkspace", arguments: {} }
    });

    const result = response!.result as { content: Array<{ text: string }> };
    const validation = JSON.parse(result.content[0]!.text) as {
      typecheck: { passed: boolean; errorCount: number };
      lint: { passed: boolean; errorCount: number; warningCount: number };
      overallPassed: boolean;
    };

    // The docker fixture has a clean typecheck (no type errors).
    expect(validation.typecheck).toBeDefined();
    expect(typeof validation.typecheck.passed).toBe("boolean");

    // Lint should run (ESLint is configured).
    expect(validation.lint).toBeDefined();
    expect(typeof validation.lint.passed).toBe("boolean");

    // overallPassed should be a boolean.
    expect(typeof validation.overallPassed).toBe("boolean");
  });

  it("formatFiles runs the detected formatter", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 23,
      method: "tools/call",
      params: { name: "formatFiles", arguments: {} }
    });

    const result = response!.result as { content: Array<{ text: string }> };
    const formatResult = JSON.parse(result.content[0]!.text) as {
      formatter: string;
      filesFormatted: number;
    };

    // The docker fixture doesn't have Prettier or Biome formatter configured,
    // so we expect formatter = "none".
    expect(formatResult.formatter).toBeDefined();
    expect(["prettier", "biome", "none"]).toContain(formatResult.formatter);
  });
});

describe("tool definitions", () => {
  it("all tools have unique names", () => {
    const names = TOOLS.map((t) => t.definition.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("all tools have non-empty descriptions", () => {
    for (const tool of TOOLS) {
      expect(tool.definition.description.length).toBeGreaterThan(20);
    }
  });

  it("all tools have inputSchema with type 'object'", () => {
    for (const tool of TOOLS) {
      expect(tool.definition.inputSchema.type).toBe("object");
      expect(tool.definition.inputSchema.properties).toBeDefined();
    }
  });

  it("findTool returns the right tool", () => {
    const tool = findTool("getProjectContext");
    expect(tool).toBeDefined();
    expect(tool!.definition.name).toBe("getProjectContext");
  });

  it("findTool returns undefined for unknown tool", () => {
    expect(findTool("nonexistent")).toBeUndefined();
  });

  it("listToolDefinitions returns all definitions", () => {
    const defs = listToolDefinitions();
    expect(defs.length).toBe(TOOLS.length);
  });
});
