/**
 * Shared tool execution for MCP, built-in chat, and native VS Code tools.
 */

import type { NodeForgeContext } from "./NodeForgeContext.js";
import { findTool } from "./tools.js";
import {
  authorizeTool,
  getMcpExecutionContext,
  type ToolAuthorizationCode,
  type ToolExecutionContext
} from "./toolPolicy.js";

export class UnknownToolError extends Error {
  override readonly name = "UnknownToolError";
  constructor(toolName: string) {
    super(`Unknown tool: ${toolName}`);
  }
}

export class ToolArgumentValidationError extends Error {
  override readonly name = "ToolArgumentValidationError";
}

export class ToolAuthorizationError extends Error {
  override readonly name = "ToolAuthorizationError";

  constructor(
    public readonly toolName: string,
    public readonly code: ToolAuthorizationCode,
    message: string
  ) {
    super(message);
  }
}

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  context: NodeForgeContext,
  executionContext: ToolExecutionContext = getMcpExecutionContext()
): Promise<string> {
  const tool = findTool(toolName);
  if (!tool) {
    throw new UnknownToolError(toolName);
  }

  validateToolArguments(toolName, args);

  const decision = authorizeTool(toolName, executionContext);
  if (!decision.allowed) {
    throw new ToolAuthorizationError(
      toolName,
      decision.code ?? "TOOL_NOT_FOUND",
      decision.reason ?? `Tool "${toolName}" is not authorized.`
    );
  }

  return tool.handler(args, context);
}

export function validateToolArguments(
  toolName: string,
  args: unknown
): asserts args is Record<string, unknown> {
  const tool = findTool(toolName);
  if (!tool) {
    throw new UnknownToolError(toolName);
  }

  if (!isRecord(args)) {
    throw new ToolArgumentValidationError(
      `Invalid arguments for "${toolName}": expected an object.`
    );
  }

  const schema = tool.definition.inputSchema;
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];

  for (const requiredName of required) {
    if (!(requiredName in args) || args[requiredName] === undefined) {
      throw new ToolArgumentValidationError(
        `Invalid arguments for "${toolName}": missing required argument "${requiredName}".`
      );
    }
  }

  for (const key of Object.keys(args)) {
    const propertySchema = properties[key];
    if (!isRecord(propertySchema)) {
      throw new ToolArgumentValidationError(
        `Invalid arguments for "${toolName}": unexpected argument "${key}".`
      );
    }

    validateValue(toolName, key, args[key], propertySchema);
  }
}

function validateValue(
  toolName: string,
  key: string,
  value: unknown,
  schema: Record<string, unknown>
): void {
  const type = schema.type;

  if (type === "string" && typeof value !== "string") {
    throw new ToolArgumentValidationError(
      `Invalid argument "${key}" for "${toolName}": expected a string.`
    );
  }

  if (type === "array") {
    if (!Array.isArray(value)) {
      throw new ToolArgumentValidationError(
        `Invalid argument "${key}" for "${toolName}": expected an array.`
      );
    }

    const itemSchema = isRecord(schema.items) ? schema.items : undefined;
    if (itemSchema?.type === "string" && value.some((item) => typeof item !== "string")) {
      throw new ToolArgumentValidationError(
        `Invalid argument "${key}" for "${toolName}": every item must be a string.`
      );
    }
  }

  if (type === "boolean" && typeof value !== "boolean") {
    throw new ToolArgumentValidationError(
      `Invalid argument "${key}" for "${toolName}": expected a boolean.`
    );
  }

  if (type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new ToolArgumentValidationError(
      `Invalid argument "${key}" for "${toolName}": expected a finite number.`
    );
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    throw new ToolArgumentValidationError(
      `Invalid argument "${key}" for "${toolName}": value is not allowed.`
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
