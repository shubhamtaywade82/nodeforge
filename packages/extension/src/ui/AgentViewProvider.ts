/**
 * Agent sidebar — shows MCP server status, tool reference, and setup instructions.
 *
 *   Agent
 *   ├─ MCP Server
 *   │   ├─ Status: not running
 *   │   └─ Setup: Configure in Cursor MCP settings
 *   ├─ Available Tools (17)
 *   │   ├─ getProjectContext — Get workspace profile...
 *   │   ├─ getDiagnostics — Run TS + ESLint/Biome...
 *   │   └─ ...
 *   └─ Setup Instructions
 *       ├─ Step 1: Build the MCP server
 *       ├─ Step 2: Add to .cursor/mcp.json
 *       └─ Step 3: Restart Cursor
 */

import * as vscode from "vscode";
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
        { kind: "section", label: "MCP Server", description: "not running" },
        { kind: "section", label: "Available Tools", description: String(TOOLS.length) },
        { kind: "section", label: "Setup Instructions", description: "" }
      ];
    }

    if (element.label === "MCP Server") {
      return [
        {
          kind: "field",
          label: "Status",
          description: "not running",
          tooltip: "The MCP server runs as a standalone process spawned by Cursor — it is not started by the extension itself."
        },
        {
          kind: "field",
          label: "Protocol",
          description: "JSON-RPC 2.0 over stdio",
          tooltip: "The server communicates via newline-delimited JSON-RPC 2.0 over stdin/stdout."
        },
        {
          kind: "field",
          label: "Capabilities",
          description: "tools + resources + prompts",
          tooltip: "The server exposes 17 tools, 22 resource types, and 6 prompts."
        }
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

    if (element.label === "Setup Instructions") {
      return [
        {
          kind: "field",
          label: "Step 1",
          description: "Build the MCP server",
          tooltip: "Run: cd packages/agent && pnpm build\nThis produces dist/cli.js — the MCP server entry point."
        },
        {
          kind: "field",
          label: "Step 2",
          description: "Add to .cursor/mcp.json",
          tooltip: `Create .cursor/mcp.json in your project root:\n\n{\n  "mcpServers": {\n    "nodeforge": {\n      "command": "node",\n      "args": ["/path/to/nodeforge/packages/agent/dist/cli.js"],\n      "env": {\n        "NODEFORGE_WORKSPACE_ROOT": "/path/to/your/project"\n      }\n    }\n  }\n}`
        },
        {
          kind: "field",
          label: "Step 3",
          description: "Restart Cursor",
          tooltip: "After saving the config, restart Cursor or reload the window. The NodeForge MCP server will appear with a green 'connected' status."
        },
        {
          kind: "field",
          label: "Docs",
          description: "See INSTALL.md",
          tooltip: "Full setup instructions are in the INSTALL.md file at the repo root."
        }
      ];
    }

    return [];
  }
}
