/**
 * MCP server — JSON-RPC 2.0 over stdio.
 *
 * Implements the Model Context Protocol (MCP) specification:
 *   - https://spec.modelcontextprotocol.io/
 *
 * The server reads JSON-RPC messages from stdin, processes them, and writes
 * responses to stdout. Each message is a single line of JSON (newline-delimited
 * JSON-RPC, which is the standard MCP transport).
 *
 * Supported methods:
 *   - `initialize`           — handshake, returns server info + capabilities
 *   - `notifications/initialized` — client notification (no response)
 *   - `tools/list`           — returns available tool definitions
 *   - `tools/call`           — calls a tool by name with arguments
 *   - `ping`                 — health check
 *
 * The server is intentionally minimal — it doesn't implement resources,
 * prompts, or subscriptions. Those can be added later.
 */

import { createContextFromEnv, NodeForgeContext } from "./NodeForgeContext.js";
import { findTool, listToolDefinitions } from "./tools.js";

// JSON-RPC 2.0 types
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

const SERVER_INFO = {
  name: "nodeforge-mcp",
  version: "0.0.1"
};

const SERVER_CAPABILITIES = {
  tools: { listChanged: false }
};

export class McpServer {
  private readonly context: NodeForgeContext;
  private initialized = false;

  constructor(context?: NodeForgeContext) {
    this.context = context ?? createContextFromEnv();
  }

  /**
   * Process a single JSON-RPC message. Returns a response for requests,
   * or undefined for notifications.
   */
  async handleMessage(raw: JsonRpcRequest | JsonRpcNotification): Promise<JsonRpcResponse | undefined> {
    // Notifications (no `id` field) don't get a response.
    const isRequest = "id" in raw && raw.id !== undefined && raw.id !== null;
    const id = isRequest ? (raw as JsonRpcRequest).id! : null;

    try {
      switch (raw.method) {
        case "initialize":
          return this.handleInitialize(id);

        case "notifications/initialized":
          this.initialized = true;
          return undefined; // notification — no response

        case "ping":
          return { jsonrpc: "2.0", id, result: {} };

        case "tools/list":
          return this.handleToolsList(id);

        case "tools/call":
          return await this.handleToolsCall(id, raw.params);

        default:
          if (isRequest) {
            return {
              jsonrpc: "2.0",
              id,
              error: {
                code: -32601,
                message: `Method not found: ${raw.method}`
              }
            };
          }
          return undefined;
      }
    } catch (err) {
      if (!isRequest) return undefined;
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: "Internal error",
          data: err instanceof Error ? err.message : String(err)
        }
      };
    }
  }

  private handleInitialize(id: string | number | null): JsonRpcResponse {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: SERVER_CAPABILITIES,
        serverInfo: SERVER_INFO
      }
    };
  }

  private handleToolsList(id: string | number | null): JsonRpcResponse {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: listToolDefinitions()
      }
    };
  }

  private async handleToolsCall(id: string | number | null, params: unknown): Promise<JsonRpcResponse> {
    const p = params as { name?: string; arguments?: Record<string, unknown> } | undefined;
    if (!p || typeof p.name !== "string") {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32602,
          message: "Invalid params: expected { name: string, arguments?: object }"
        }
      };
    }

    const tool = findTool(p.name);
    if (!tool) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32602,
          message: `Unknown tool: ${p.name}`
        }
      };
    }

    const args = p.arguments ?? {};
    const resultText = await tool.handler(args, this.context);

    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          {
            type: "text",
            text: resultText
          }
        ]
      }
    };
  }
}

/**
 * Run the MCP server on stdio. Reads lines from stdin, processes each as a
 * JSON-RPC message, and writes responses to stdout (one per line).
 *
 * This is the entry point when the server is spawned by an MCP client.
 */
export async function runStdioServer(): Promise<void> {
  const server = new McpServer();
  const { stdin, stdout } = process;

  // Use readline to process input line by line.
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: stdin, terminal: false });

  stdout.setDefaultEncoding("utf8");

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let message: JsonRpcRequest | JsonRpcNotification;
    try {
      message = JSON.parse(trimmed) as JsonRpcRequest | JsonRpcNotification;
    } catch {
      // Malformed JSON — skip silently. (Could send a parse error response
      // if we had a request id, but we don't.)
      continue;
    }

    const response = await server.handleMessage(message);
    if (response) {
      stdout.write(JSON.stringify(response) + "\n");
    }
  }
}
