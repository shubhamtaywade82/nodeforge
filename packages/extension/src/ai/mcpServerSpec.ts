/** Pure construction of the NodeForge MCP stdio server launch spec. No `vscode` import. */

export const MCP_PROVIDER_ID = "nodeforge.mcp";
export const MCP_SERVER_LABEL = "NodeForge";
/** Bundled MCP entry point, relative to the extension root. */
export const MCP_BUNDLE_RELATIVE_PATH = ["dist", "mcp.cjs"] as const;

export interface McpServerSpecInput {
  readonly extensionPath: string;
  readonly workspaceRoot: string;
  /** Value of `nodeforge.runtime.preferredNodeBinary`; empty means "use the host runtime". */
  readonly preferredNodeBinary: string;
  /** `process.execPath` of the extension host (Electron/Node). */
  readonly hostExecPath: string;
  readonly version: string;
  readonly pathSeparator: string;
  /** Capabilities granted to the MCP server (see packages/agent toolPolicy). Execution is on by default. */
  readonly allowExecution?: boolean;
  readonly allowWrites?: boolean;
  readonly allowNetwork?: boolean;
}

export interface McpServerSpec {
  readonly label: string;
  readonly command: string;
  readonly args: string[];
  readonly env: Record<string, string>;
  readonly version: string;
}

export function buildMcpServerSpec(input: McpServerSpecInput): McpServerSpec {
  if (!input.workspaceRoot) throw new Error("A workspace root is required to start the NodeForge MCP server.");
  const script = [input.extensionPath, ...MCP_BUNDLE_RELATIVE_PATH].join(input.pathSeparator);
  const preferred = input.preferredNodeBinary.trim();

  // The extension host is an Electron binary. It behaves as plain Node only with
  // ELECTRON_RUN_AS_NODE=1, so a user-supplied Node binary needs no such flag.
  const command = preferred || input.hostExecPath;
  // The server denies everything by default. VS Code only offers this provider in trusted
  // workspaces, so trust and execution are granted; writes and network stay opt-in.
  const env: Record<string, string> = {
    NODEFORGE_WORKSPACE_ROOT: input.workspaceRoot,
    NODEFORGE_WORKSPACE_TRUSTED: "true",
    NODEFORGE_ALLOW_EXECUTION: String(input.allowExecution ?? true),
    NODEFORGE_ALLOW_WRITES: String(input.allowWrites ?? false),
    NODEFORGE_ALLOW_NETWORK: String(input.allowNetwork ?? false)
  };
  if (!preferred) env["ELECTRON_RUN_AS_NODE"] = "1";

  return { label: MCP_SERVER_LABEL, command, args: [script], env, version: input.version };
}
