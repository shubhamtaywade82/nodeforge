#!/usr/bin/env node
/**
 * NodeForge MCP server CLI entry point.
 *
 * Cursor (or any MCP client) spawns this script as a child process and
 * communicates via JSON-RPC 2.0 over stdio.
 *
 * Configure in Cursor's MCP settings:
 *
 *   {
 *     "mcpServers": {
 *       "nodeforge": {
 *         "command": "node",
 *         "args": ["/path/to/nodeforge/packages/agent/dist/cli.js"],
 *         "env": {
 *           "NODEFORGE_WORKSPACE_ROOT": "/path/to/your/project"
 *         }
 *       }
 *     }
 *   }
 */

import { runStdioServer } from "./McpServer.js";

runStdioServer().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[nodeforge:mcp] server failed to start", err);
  process.exit(1);
});
