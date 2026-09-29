/**
 * Central tool authorization policy used by MCP, built-in AgentLoop, and
 * native VS Code language-model tools.
 *
 * Static reads are available by default. Tools that execute project-controlled
 * code require explicit execution permission, and workspace mutations require
 * a second explicit write permission for MCP callers.
 */

export type ToolRisk = "read" | "execute" | "write";
export type ToolCaller = "mcp" | "agent" | "vscode";

export interface ToolPolicy {
  readonly risk: ToolRisk;
  readonly requiresTrust: boolean;
  readonly requiresApproval: boolean;
  readonly mutatesWorkspace: boolean;
  readonly executesCode: boolean;
  readonly usesNetwork: boolean;
}

export interface ToolExecutionContext {
  readonly caller: ToolCaller;
  readonly workspaceTrusted: boolean;
  readonly executionAllowed: boolean;
  readonly writesAllowed: boolean;
  readonly networkAllowed: boolean;
  readonly approvalGranted: boolean;
}

export type ToolAuthorizationCode =
  | "TOOL_NOT_FOUND"
  | "WORKSPACE_NOT_TRUSTED"
  | "EXECUTION_DISABLED"
  | "NETWORK_DISABLED"
  | "WRITES_DISABLED"
  | "APPROVAL_REQUIRED";

export interface ToolAuthorizationDecision {
  readonly allowed: boolean;
  readonly code?: ToolAuthorizationCode;
  readonly reason?: string;
}

const READ_TOOLS = new Set([
  "getProjectContext",
  "getGitState",
  "getGitDiff",
  "getDatabaseSchema",
  "getDockerConfig",
  "getKubernetesManifests",
  "getGitHubWorkflows",
  "getDependencyGraph"
]);

const EXECUTE_TOOLS = new Set([
  "getDiagnostics",
  "runTypeCheck",
  "runLinter",
  "getTestResults",
  "runTests",
  "getDependencyReport",
  "validateWorkspace"
]);

const WRITE_TOOLS = new Set([
  "formatFiles",
  "applyEslintFix"
]);

export const TOOL_POLICIES: Readonly<Record<string, ToolPolicy>> = Object.freeze({
  ...Object.fromEntries(
    [...READ_TOOLS].map((name) => [
      name,
      {
        risk: "read",
        requiresTrust: false,
        requiresApproval: false,
        mutatesWorkspace: false,
        executesCode: false,
        usesNetwork: false
      } satisfies ToolPolicy
    ])
  ),
  ...Object.fromEntries(
    [...EXECUTE_TOOLS].map((name) => [
      name,
      {
        risk: "execute",
        requiresTrust: true,
        requiresApproval: false,
        mutatesWorkspace: false,
        executesCode: true,
        usesNetwork:
          name === "getDependencyReport" || name === "validateWorkspace"
      } satisfies ToolPolicy
    ])
  ),
  ...Object.fromEntries(
    [...WRITE_TOOLS].map((name) => [
      name,
      {
        risk: "write",
        requiresTrust: true,
        requiresApproval: true,
        mutatesWorkspace: true,
        executesCode: false,
        usesNetwork: false
      } satisfies ToolPolicy
    ])
  ),
  runScript: {
    risk: "execute",
    requiresTrust: true,
    requiresApproval: true,
    mutatesWorkspace: true,
    executesCode: true,
    usesNetwork: false
  } satisfies ToolPolicy
});

export function getToolPolicy(toolName: string): ToolPolicy | undefined {
  return TOOL_POLICIES[toolName];
}

export function authorizeTool(
  toolName: string,
  context: ToolExecutionContext
): ToolAuthorizationDecision {
  const policy = getToolPolicy(toolName);
  if (!policy) {
    return {
      allowed: false,
      code: "TOOL_NOT_FOUND",
      reason: `No execution policy is defined for tool "${toolName}".`
    };
  }

  if (policy.risk !== "read" && !context.executionAllowed) {
    return {
      allowed: false,
      code: "EXECUTION_DISABLED",
      reason: "Project code execution is disabled for this caller."
    };
  }

  if (policy.requiresTrust && !context.workspaceTrusted) {
    return {
      allowed: false,
      code: "WORKSPACE_NOT_TRUSTED",
      reason: "Workspace is not trusted."
    };
  }

  if (policy.usesNetwork && !context.networkAllowed) {
    return {
      allowed: false,
      code: "NETWORK_DISABLED",
      reason: "Network access for this tool is disabled for this caller."
    };
  }

  if (policy.mutatesWorkspace && !context.writesAllowed) {
    return {
      allowed: false,
      code: "WRITES_DISABLED",
      reason: "Workspace writes are disabled for this caller."
    };
  }

  if (
    policy.requiresApproval &&
    context.caller !== "mcp" &&
    !context.approvalGranted
  ) {
    return {
      allowed: false,
      code: "APPROVAL_REQUIRED",
      reason: "Explicit user approval is required for this operation."
    };
  }

  return { allowed: true };
}

export function getMcpExecutionContext(
  env: NodeJS.ProcessEnv = process.env
): ToolExecutionContext {
  return {
    caller: "mcp",
    workspaceTrusted: readBoolean(env.NODEFORGE_WORKSPACE_TRUSTED),
    executionAllowed: readBoolean(env.NODEFORGE_ALLOW_EXECUTION),
    writesAllowed: readBoolean(env.NODEFORGE_ALLOW_WRITES),
    networkAllowed: readBoolean(env.NODEFORGE_ALLOW_NETWORK),
    approvalGranted: false
  };
}

export function isWriteTool(toolName: string): boolean {
  return getToolPolicy(toolName)?.mutatesWorkspace ?? false;
}

export function isExecutableTool(toolName: string): boolean {
  return getToolPolicy(toolName)?.executesCode ?? false;
}

export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set(
  Object.entries(TOOL_POLICIES)
    .filter(([, policy]) => policy.mutatesWorkspace)
    .map(([name]) => name)
);

function readBoolean(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}
