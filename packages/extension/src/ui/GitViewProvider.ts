/**
 * Git sidebar — shows the current GitState.
 *
 *   Git
 *   ├─ Branch: main
 *   ├─ HEAD: a0c87ab3e2
 *   ├─ Status: dirty (2 changed, 1 staged)
 *   ├─ Upstream: origin/main
 *   ├─ Ahead/Behind: +1 -0
 *   ├─ Changed Files
 *   │   ├─ src/foo.ts
 *   │   └─ src/bar.ts
 *   └─ Staged Files
 *       └─ src/baz.ts
 *
 * The view is refreshed by an explicit command (`nodeforge.refreshGit`).
 */

import * as vscode from "vscode";
import * as path from "node:path";
import type { GitState } from "@nodeforge/contracts";

type NodeKind = "field" | "section" | "file" | "empty";

interface TreeNode {
  kind: NodeKind;
  label: string;
  description?: string;
  tooltip?: string;
  collapsible?: boolean;
  file?: string;
}

export class GitViewProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  private state: GitState | undefined;

  setState(state: GitState | undefined): void {
    this.state = state;
    this.emitter.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label);
    item.description = element.description ?? "";
    if (element.tooltip) item.tooltip = element.tooltip;
    if (element.kind === "section") {
      item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      item.iconPath = new vscode.ThemeIcon("folder");
    } else if (element.kind === "file") {
      item.collapsibleState = vscode.TreeItemCollapsibleState.None;
      item.iconPath = new vscode.ThemeIcon("file");
      if (element.file) {
        item.command = {
          command: "nodeforge.openDiagnostic",
          title: "Open File",
          arguments: [element.file, 1, 1]
        };
      }
    } else {
      item.collapsibleState = vscode.TreeItemCollapsibleState.None;
      item.iconPath = new vscode.ThemeIcon("info");
    }
    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!this.state) {
      if (!element) {
        return [
          {
            kind: "empty",
            label: "Not a git repository",
            description: "Open a git repo to see state"
          }
        ];
      }
      return [];
    }

    const s = this.state;

    if (!element) {
      const statusDesc = s.dirty
        ? `dirty (${s.changedFiles.length} changed, ${s.stagedFiles.length} staged)`
        : "clean";
      const children: TreeNode[] = [
        field("Branch", s.branch + (s.detached ? " (detached)" : "")),
        field("HEAD", s.headShort),
        field("Status", statusDesc),
        ...(s.upstream ? [field("Upstream", s.upstream)] : []),
        ...(s.ahead > 0 || s.behind > 0
          ? [field("Ahead/Behind", `+${s.ahead} -${s.behind}`)]
          : [])
      ];
      if (s.changedFiles.length > 0) {
        children.push({ kind: "section", label: "Changed Files", description: String(s.changedFiles.length) });
      }
      if (s.stagedFiles.length > 0) {
        children.push({ kind: "section", label: "Staged Files", description: String(s.stagedFiles.length) });
      }
      return children;
    }

    if (element.kind === "section") {
      if (element.label === "Changed Files") {
        return s.changedFiles.map((rel) => ({
          kind: "file" as const,
          label: rel,
          file: path.join(s.root, rel),
          tooltip: `Changed: ${rel}`
        }));
      }
      if (element.label === "Staged Files") {
        return s.stagedFiles.map((rel) => ({
          kind: "file" as const,
          label: rel,
          file: path.join(s.root, rel),
          tooltip: `Staged: ${rel}`
        }));
      }
    }

    return [];
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
