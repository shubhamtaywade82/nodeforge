/**
 * Workspace sidebar TreeView.
 *
 * Renders the cached `WorkspaceProfile` as a flat tree:
 *
 *   Workspace
 *   ├─ runtime:      node
 *   ├─ package manager: pnpm
 *   ├─ typescript:   yes
 *   ├─ linter:       eslint
 *   ├─ formatter:    prettier
 *   ├─ test runner:  vitest
 *   ├─ orm:          prisma
 *   ├─ docker:       yes
 *   ├─ github actions: yes
 *   └─ monorepo:     pnpm
 */

import * as vscode from "vscode";
import type { WorkspaceProfile } from "@nodeforge/contracts";
import type { WorkspaceManager } from "../core/WorkspaceManager.js";

type NodeKind = "section" | "field" | "evidence" | "empty";

interface TreeNode {
  kind: NodeKind;
  label: string;
  description?: string;
  tooltip?: string;
}

export class WorkspaceViewProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  private profile: WorkspaceProfile | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly manager: WorkspaceManager
  ) {}

  refresh(): void {
    this.emitter.fire(undefined);
  }

  render(profile: WorkspaceProfile): void {
    this.profile = profile;
    this.emitter.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label);
    item.description = element.description ?? "";
    if (element.tooltip) item.tooltip = element.tooltip;
    if (element.kind === "section") {
      item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      item.contextValue = "section";
    } else {
      item.collapsibleState = vscode.TreeItemCollapsibleState.None;
      item.contextValue = "field";
    }
    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!this.profile) {
      return [
        {
          kind: "empty",
          label: "Workspace not analyzed",
          description: "Click 'Analyze Workspace' to detect",
          tooltip: "Run the 'NodeForge: Analyze Workspace' command"
        }
      ];
    }

    if (!element) {
      // Top level: sections.
      return [
        { kind: "section", label: "Runtime" },
        { kind: "section", label: "Languages" },
        { kind: "section", label: "Quality" },
        { kind: "section", label: "Testing" },
        { kind: "section", label: "Data" },
        { kind: "section", label: "Infrastructure" },
        { kind: "section", label: "Monorepo" }
      ];
    }

    const p = this.profile;
    switch (element.label) {
      case "Runtime":
        return [
          field("Runtime", p.runtime),
          field("Package Manager", p.packageManager),
          ...(p.signals.engines ? [evidenceField("Engines", JSON.stringify(p.signals.engines))] : [])
        ];
      case "Languages":
        return [field("TypeScript", p.typescript ? "yes" : "no")];
      case "Quality":
        return [
          field("Linter", p.linter ?? "—"),
          field("Formatter", p.formatter ?? "—")
        ];
      case "Testing":
        return [field("Test Runner", p.testRunner ?? "—")];
      case "Data":
        return [field("ORM", p.orm ?? "—")];
      case "Infrastructure":
        return [
          field("Docker", p.docker ? "yes" : "no"),
          field("Kubernetes", p.kubernetes ? "yes" : "no"),
          field("GitHub Actions", p.githubActions ? "yes" : "no")
        ];
      case "Monorepo":
        return [
          field("Kind", p.monorepo),
          ...(p.workspacePackages.length > 0
            ? [evidenceField("Packages", `${p.workspacePackages.length} workspace packages`)]
            : [])
        ];
      default:
        return [];
    }
  }
}

function field(label: string, value: string): TreeNode {
  return {
    kind: "field",
    label,
    description: value,
    tooltip: `${label}: ${value}`
  };
}

function evidenceField(label: string, value: string): TreeNode {
  return {
    kind: "evidence",
    label: `  ↳ ${label}`,
    description: value,
    tooltip: `Evidence: ${value}`
  };
}
