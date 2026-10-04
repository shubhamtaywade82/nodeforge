/**
 * Registers the bundled NodeForge MCP server with VS Code's native MCP support,
 * so agent mode can use it without hand-written `mcp.json` configuration.
 */

import * as vscode from "vscode";
import * as path from "node:path";
import { MCP_PROVIDER_ID, buildMcpServerSpec } from "./mcpServerSpec.js";
import { logger } from "../core/Logger.js";

export function registerNodeForgeMcpProvider(
  context: vscode.ExtensionContext,
  isTrusted: () => boolean,
  resolveRoot: () => string | undefined
): void {
  const changed = new vscode.EventEmitter<void>();
  const version = String(
    (context.extension.packageJSON as { version?: string }).version ?? "0.0.0"
  );

  const provider: vscode.McpServerDefinitionProvider<vscode.McpStdioServerDefinition> = {
    onDidChangeMcpServerDefinitions: changed.event,

    provideMcpServerDefinitions: () => {
      // The server runs project tooling (tsc, tests, scripts); never offer it in Restricted Mode.
      const root = resolveRoot();
      if (!root || !isTrusted()) return [];

      const preferred = vscode.workspace
        .getConfiguration("nodeforge.runtime")
        .get<string>("preferredNodeBinary", "");
      const mcp = vscode.workspace.getConfiguration("nodeforge.mcp");
      const spec = buildMcpServerSpec({
        allowExecution: mcp.get<boolean>("allowExecution", true),
        allowWrites: mcp.get<boolean>("allowWrites", false),
        allowNetwork: mcp.get<boolean>("allowNetwork", false),
        extensionPath: context.extensionPath,
        workspaceRoot: root,
        preferredNodeBinary: preferred,
        hostExecPath: process.execPath,
        version,
        pathSeparator: path.sep
      });
      return [new vscode.McpStdioServerDefinition(spec.label, spec.command, spec.args, spec.env, spec.version)];
    },

    resolveMcpServerDefinition: (server) => {
      if (!isTrusted()) {
        logger.warn("Refusing to start NodeForge MCP server in Restricted Mode");
        return undefined;
      }
      return server;
    }
  };

  context.subscriptions.push(
    changed,
    vscode.lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, provider),
    vscode.workspace.onDidChangeWorkspaceFolders(() => changed.fire()),
    vscode.workspace.onDidGrantWorkspaceTrust(() => changed.fire()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("nodeforge.runtime.preferredNodeBinary") ||
        e.affectsConfiguration("nodeforge.mcp")
      ) {
        changed.fire();
      }
    })
  );
}
