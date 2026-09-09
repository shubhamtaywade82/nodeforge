/**
 * Agent sidebar — shows MCP server status and tool reference.
 *
 *   Agent
 *   ├─ MCP Server
 *   │   ├─ Status: ready
 *   │   └─ Workspace: /path/to/project
 *   ├─ Available Tools (9)
 *   │   ├─ getProjectContext — Get workspace profile...
 *   │   ├─ getDiagnostics — Run TS + ESLint/Biome...
 *   │   └─ ...
 *   └─ Setup
 *       └─ Configure in Cursor MCP settings...
 */

import * as vscode from "vscode";
import * as path from "node:path";
import { TOOLS } from "@nodeforge/agent";

type NodeKind = "section" | "field" | "tool" | "empty";

interface TreeNode {
  kind: NodeKind;
  label: string;
  description?: string;
  tooltip?: string;
}

export class AgentViewProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext
  ) {}

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label);
    item.description = element.description ?? "";
    if (element.tooltip) item.tooltip = element.tooltip;
    if (element.kind === "section") {
      item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      item.iconPath = new vscode.ThemeIcon("folder");
    } else if (element.kind === "tool") {
      item.collapsibleState = vscode.TreeItemCollapsibleState.None;
      item.iconPath = new vscode.ThemeIcon("tools");
    } else {
      item.collapsibleState = vscode.TreeItemCollapsibleState.None;
      item.iconPath = new vscode.ThemeIcon("info");
    }
    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return [
        { kind: "section", label: "MCP Server", description: "ready" },
        { kind: "section", label: "Available Tools", description: String(TOOLS.length) },
        { kind: "section", label: "Setup", description: "" }
      ];
    }

    if (element.label === "MCP Server") {
      const cliPath = path.join(this.context.extensionPath, "packages", "agent", "dist", "cli.js");
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "(no workspace)";
      return [
        { kind: "field", label: "Status", description: "ready", tooltip: "The MCP server is available as a standalone process" },
        { kind: "field", label: "CLI Path", description: cliPath, tooltip: `Cursor MCP config command: node ${cliPath}` },
        { kind: "field", label: "Workspace", description: root, tooltip: `NODEFORGE_WORKSPACE_ROOT: ${root}` }
      ];
    }

    if (element.label === "Available Tools") {
      return TOOLS.map((t) => ({
        kind: "tool" as const,
        label: t.definition.name,
        description: t.definition.description.split(".")[0]!,
        tooltip: t.definition.description
      }));
    }

    if (element.label === "Setup") {
      return [
        {
          kind: "field",
          label: "Cursor",
          description: "Settings → MCP",
          tooltip: "Add the NodeForge MCP server in Cursor's MCP settings. See packages/agent/README.md for the JSON config."
        },
        {
          kind: "field",
          label: "Claude Code",
          description: ".mcp.json",
          tooltip: "Add to .mcp.json in your project root. See packages/agent/README.md."
        }
      ];
    }

    return [];
  }
}
