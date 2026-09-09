/**
 * Tests for the MCP server — JSON-RPC message handling and tool dispatch.
 *
 * These tests use the real `node-ts-with-errors` fixture so tool handlers
 * actually run adapters and return real diagnostics / test results.
 */

import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { McpServer } from "../src/McpServer.js";
import { NodeForgeContext } from "../src/NodeForgeContext.js";
import { TOOLS, findTool, listToolDefinitions } from "../src/tools.js";

const FIXTURE = path.resolve(__dirname, "../../test-fixtures/node-ts-with-errors");

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
    expect(result.tools.length).toBeGreaterThanOrEqual(9);
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
        "getDatabaseSchema"
      ])
    );
  });

  it("returns method-not-found error for unknown methods", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "resources/list"
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
    };
    expect(profile.runtime).toBe("node");
    expect(profile.typescript).toBe(true);
    expect(profile.linter).toBe("eslint");
  });

  it("getDiagnostics returns TypeScript + ESLint findings", async () => {
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

    // Should have TypeScript errors (TS2304, TS2322, etc.)
    const tsFindings = diagnostics.filter((d) => d.source === "typescript");
    expect(tsFindings.length).toBeGreaterThanOrEqual(1);

    // Should have ESLint warnings (no-unused-vars)
    const eslintFindings = diagnostics.filter((d) => d.source === "eslint");
    expect(eslintFindings.length).toBeGreaterThanOrEqual(1);

    // All findings should have absolute file paths
    for (const d of diagnostics) {
      expect(d.file).toContain("broken.ts");
    }
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
    for (const d of diagnostics) {
      expect(d.source).toBe("typescript");
    }
  });

  it("runLinter returns only ESLint findings", async () => {
    const server = makeServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: { name: "runLinter", arguments: {} }
    });

    const result = response!.result as { content: Array<{ text: string }> };
    const diagnostics = JSON.parse(result.content[0]!.text) as Array<{ source: string }>;
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
