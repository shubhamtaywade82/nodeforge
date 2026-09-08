/**
 * Diagnostics sidebar — renders the live `DiagnosticStore` as a tree:
 *
 *   Diagnostics
 *   ├─ TypeScript (3 errors, 1 warning)
 *   │   ├─ src/foo.ts:12:5 — Cannot find name 'foo'.
 *   │   └─ src/bar.ts:3:1 — 'x' is declared but never read.
 *   ├─ ESLint (2 warnings)
 *   │   └─ src/broken.ts:24:33 — 'unusedParam' is defined but never used.
 *   └─ Biome (1 error)
 *       └─ src/broken.ts:8:7 — This let declares a variable that is only assigned once.
 *
 * Subscribes to `diagnostics.snapshot` events so the tree refreshes whenever
 * any adapter publishes new findings.
 */

import * as vscode from "vscode";
import * as path from "node:path";
import type { EventBus, Diagnostic, DiagnosticSnapshot } from "@nodeforge/contracts";
import type { DiagnosticStore } from "@nodeforge/core";

type NodeKind = "source" | "diagnostic" | "empty";

interface TreeNode {
  kind: NodeKind;
  label: string;
  description?: string;
  tooltip?: string;
  /** Children for collapsible nodes. */
  file?: string;
  line?: number;
  column?: number;
}

export class DiagnosticsViewProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  private snapshot: DiagnosticSnapshot | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: DiagnosticStore,
    bus: EventBus
  ) {
    bus.subscribe("diagnostics.snapshot", (e) => {
      this.snapshot = e.snapshot;
      this.emitter.fire(undefined);
    });
    bus.subscribe("diagnostics.cleared", () => {
      this.snapshot = this.store.snapshot();
      this.emitter.fire(undefined);
    });
  }

  refresh(): void {
    this.snapshot = this.store.snapshot();
    this.emitter.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label);
    item.description = element.description ?? "";
    if (element.tooltip) item.tooltip = element.tooltip;
    if (element.kind === "source") {
      item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      item.contextValue = "source";
      item.iconPath = new vscode.ThemeIcon("folder");
    } else if (element.kind === "diagnostic") {
      item.collapsibleState = vscode.TreeItemCollapsibleState.None;
      item.contextValue = "diagnostic";
      item.iconPath = new vscode.ThemeIcon("warning");
      // Clicking a diagnostic navigates to the file/line.
      if (element.file) {
        const line = element.line ?? 1;
        const col = element.column ?? 1;
        item.command = {
          command: "nodeforge.openDiagnostic",
          title: "Open Diagnostic",
          arguments: [element.file, line, col]
        };
      }
    } else {
      item.collapsibleState = vscode.TreeItemCollapsibleState.None;
      item.contextValue = "empty";
      item.iconPath = new vscode.ThemeIcon("info");
    }
    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!this.snapshot || this.snapshot.diagnostics.length === 0) {
      if (!element) {
        return [
          {
            kind: "empty",
            label: "No diagnostics",
            description: "Run diagnostics to populate",
            tooltip: "Run the 'NodeForge: Run Diagnostics' command"
          }
        ];
      }
      return [];
    }

    if (!element) {
      // Top level: one node per source.
      const bySource = groupBySource(this.snapshot.diagnostics);
      return Array.from(bySource.entries()).map(([source, diags]) => {
        const counts = countBySeverity(diags);
        const parts: string[] = [];
        if (counts.error > 0) parts.push(`${counts.error} error${counts.error > 1 ? "s" : ""}`);
        if (counts.warning > 0) parts.push(`${counts.warning} warning${counts.warning > 1 ? "s" : ""}`);
        if (counts.info > 0) parts.push(`${counts.info} info`);
        if (counts.hint > 0) parts.push(`${counts.hint} hints`);
        const desc = parts.length > 0 ? parts.join(", ") : `${diags.length} finding${diags.length > 1 ? "s" : ""}`;
        return {
          kind: "source" as const,
          label: capitalize(source),
          description: desc,
          tooltip: `${source}: ${diags.length} finding${diags.length > 1 ? "s" : ""}`
        };
      });
    }

    if (element.kind === "source") {
      // Children: diagnostics for this source.
      const bySource = groupBySource(this.snapshot.diagnostics);
      const diags = bySource.get(element.label.toLowerCase()) ?? [];
      return diags.map((d) => toDiagnosticNode(d));
    }

    return [];
  }
}

function groupBySource(diagnostics: Diagnostic[]): Map<string, Diagnostic[]> {
  const map = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    let arr = map.get(d.source);
    if (!arr) {
      arr = [];
      map.set(d.source, arr);
    }
    arr.push(d);
  }
  // Sort sources alphabetically for stable ordering.
  return new Map(Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])));
}

function countBySeverity(diagnostics: Diagnostic[]): {
  error: number;
  warning: number;
  info: number;
  hint: number;
} {
  const counts = { error: 0, warning: 0, info: 0, hint: 0 };
  for (const d of diagnostics) counts[d.severity]++;
  return counts;
}

function toDiagnosticNode(d: Diagnostic): TreeNode {
  const relFile = d.file;
  const fileName = path.basename(relFile);
  const loc = `${d.range.line}:${d.range.column}`;
  const rule = d.rule ? ` [${d.rule}]` : "";
  return {
    kind: "diagnostic",
    label: `${fileName}:${loc} — ${d.message}${rule}`,
    description: "",
    tooltip: `${d.source}: ${d.message}\nFile: ${d.file}\nLine: ${d.range.line}, Column: ${d.range.column}${d.rule ? `\nRule: ${d.rule}` : ""}`,
    file: d.file,
    line: d.range.line,
    column: d.range.column
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
