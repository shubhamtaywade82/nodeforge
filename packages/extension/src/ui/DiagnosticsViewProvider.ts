/**
 * Diagnostics sidebar — a placeholder for v0.0.x.
 *
 * Subscribes to `diagnostics.snapshot` events and renders a flat summary.
 * The full normalized diagnostic store ships in v0.0.7 (per roadmap).
 */

import * as vscode from "vscode";
import type { EventBus } from "@nodeforge/contracts";
import type { DiagnosticSnapshot } from "@nodeforge/contracts";

interface DiagNode {
  label: string;
  description?: string;
  collapsible: boolean;
}

export class DiagnosticsViewProvider implements vscode.TreeDataProvider<DiagNode> {
  private readonly emitter = new vscode.EventEmitter<DiagNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  private snapshot: DiagnosticSnapshot | undefined;

  constructor(
    _context: vscode.ExtensionContext,
    bus: EventBus
  ) {
    bus.subscribe("diagnostics.snapshot", (e) => {
      this.snapshot = e.snapshot;
      this.emitter.fire(undefined);
    });
    bus.subscribe("diagnostics.cleared", () => {
      this.snapshot = undefined;
      this.emitter.fire(undefined);
    });
  }

  getTreeItem(element: DiagNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label);
    item.description = element.description ?? "";
    item.collapsibleState = element.collapsible
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
    return item;
  }

  getChildren(): DiagNode[] {
    if (!this.snapshot) {
      return [
        {
          label: "No diagnostics yet",
          description: "Run typecheck / lint to populate",
          collapsible: false
        }
      ];
    }
    const c = this.snapshot.counts;
    return [
      { label: "Errors", description: String(c.error), collapsible: false },
      { label: "Warnings", description: String(c.warning), collapsible: false },
      { label: "Info", description: String(c.info), collapsible: false },
      { label: "Hints", description: String(c.hint), collapsible: false }
    ];
  }
}
