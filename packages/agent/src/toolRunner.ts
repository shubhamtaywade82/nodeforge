/**
 * Shared tool execution for MCP and built-in chat.
 */

import type { NodeForgeContext } from "./NodeForgeContext.js";
import { findTool } from "./tools.js";

export class UnknownToolError extends Error {
  override readonly name = "UnknownToolError";
  constructor(toolName: string) {
    super(`Unknown tool: ${toolName}`);
  }
}

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  context: NodeForgeContext
): Promise<string> {
  const tool = findTool(toolName);
  if (!tool) {
    throw new UnknownToolError(toolName);
  }
  return tool.handler(args, context);
}
