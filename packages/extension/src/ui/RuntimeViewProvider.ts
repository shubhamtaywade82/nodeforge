/**
 * Runtime sidebar — shows running processes managed by ProcessManager.
 *
 *   Runtime
 *   ├─ dev:api (PID 12345)  [running]
 *   │   └─ last 3 lines of stdout/stderr
 *   ├─ build:watch (PID 12346)  [running]
 *   └─ migrate (exited 0)  [stopped]
 *
 * Subscribes to `runtime.processStarted` and `runtime.processExited` events
 * so the tree refreshes whenever processes start or stop.
 */

import * as vscode from "vscode";
import type { EventBus, ProcessInfo } from "@nodeforge/contracts";
import type { ProcessManager } from "@nodeforge/core";

type NodeKind = "process" | "lines" | "empty";

interface TreeNode {
  kind: NodeKind;
  label: string;
  description?: string;
  tooltip?: string;
  /** Process id (for context actions). */
  processId?: string;
  /** Whether to render as expanded. */
  collapsible?: boolean;
  /** Children lines. */
  lines?: string[];
}

export class RuntimeViewProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly manager: ProcessManager,
    bus: EventBus
  ) {
    // Refresh on any process lifecycle change.
    bus.subscribe("runtime.processStarted", () => this.emitter.fire(undefined));
    bus.subscribe("runtime.processExited", () => this.emitter.fire(undefined));
    // Throttle runtime.event — they can fire very frequently.
    let scheduled = false;
    bus.subscribe("runtime.event", () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        this.emitter.fire(undefined);
      }, 500);
    });
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label);
    item.description = element.description ?? "";
    if (element.tooltip) item.tooltip = element.tooltip;
    if (element.kind === "process") {
      item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      item.contextValue = "process";
      item.iconPath = new vscode.ThemeIcon("server-process");
    } else if (element.kind === "lines") {
      item.collapsibleState = vscode.TreeItemCollapsibleState.None;
      item.contextValue = "lines";
      item.iconPath = new vscode.ThemeIcon("terminal");
    } else {
      item.collapsibleState = vscode.TreeItemCollapsibleState.None;
      item.contextValue = "empty";
      item.iconPath = new vscode.ThemeIcon("info");
    }
    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    const processes = this.manager.list();

    if (processes.length === 0 && !element) {
      return [
        {
          kind: "empty",
          label: "No runtime processes",
          description: "Start a dev server to populate",
          tooltip: "Run a script via the Command Palette"
        }
      ];
    }

    if (!element) {
      return processes.map((p) => toProcessNode(p));
    }

    if (element.kind === "process" && element.processId) {
      const recent = this.manager.recentLines(element.processId, 10);
      if (recent.length === 0) {
        return [
          {
            kind: "lines",
            label: "(no output yet)"
          }
        ];
      }
      return recent.slice(-5).map((line) => ({
        kind: "lines" as const,
        label: line.length > 80 ? line.slice(0, 77) + "..." : line,
        tooltip: line
      }));
    }

    return [];
  }
}

function toProcessNode(p: ProcessInfo): TreeNode {
  const running = p.endedAt === undefined;
  const state = running ? "running" : p.cancelled ? "cancelled" : `exited ${p.exitCode}`;
  return {
    kind: "process",
    label: p.name,
    description: `PID ${p.pid ?? "?"}  [${state}]`,
    tooltip: `${p.name}\nCommand: ${p.command} ${p.args.join(" ")}\nCWD: ${p.cwd}\nStarted: ${p.startedAt ?? "?"}${p.endedAt ? `\nEnded: ${p.endedAt}` : ""}${p.exitCode !== undefined ? `\nExit: ${p.exitCode}` : ""}`,
    processId: p.id,
    collapsible: true
  };
}
