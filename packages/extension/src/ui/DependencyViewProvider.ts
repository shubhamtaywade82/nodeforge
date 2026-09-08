/**
 * Dependencies sidebar — renders a `DependencyReport` as a tree:
 *
 *   Dependencies
 *   ├─ Vulnerabilities (1)
 *   │   └─ lodash (high) — Prototype Pollution
 *   │       installed: <4.17.21  recommended: 4.17.21
 *   │       advisory: GHSA-1234
 *   └─ Outdated (1)
 *       └─ lodash 4.17.20 → 4.17.21 (patch)
 */

import * as vscode from "vscode";
import type { DependencyReport, DependencyFinding, OutdatedEntry } from "@nodeforge/contracts";

type NodeKind = "root" | "section" | "finding" | "outdated" | "detail" | "empty";

interface TreeNode {
  kind: NodeKind;
  label: string;
  description?: string;
  tooltip?: string;
  /** Section identifier ("vulns" or "outdated"). */
  section?: "vulns" | "outdated";
  /** Index within the section's array. */
  index?: number;
  /** Detail key (for child nodes like "advisory:"). */
  detailKey?: string;
  /** Detail value. */
  detailValue?: string;
}

export class DependencyViewProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  private report: DependencyReport | undefined;

  setReport(report: DependencyReport | undefined): void {
    this.report = report;
    this.emitter.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label);
    item.description = element.description ?? "";
    if (element.tooltip) item.tooltip = element.tooltip;
    if (element.kind === "section") {
      item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      item.iconPath = new vscode.ThemeIcon("folder");
    } else if (element.kind === "finding") {
      item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      item.iconPath = new vscode.ThemeIcon("warning");
    } else if (element.kind === "outdated") {
      item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      item.iconPath = new vscode.ThemeIcon("arrow-circle-up");
    } else if (element.kind === "detail") {
      item.collapsibleState = vscode.TreeItemCollapsibleState.None;
      item.iconPath = new vscode.ThemeIcon("info");
    } else {
      item.collapsibleState = vscode.TreeItemCollapsibleState.None;
      item.iconPath = new vscode.ThemeIcon("info");
    }
    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!this.report) {
      if (!element) {
        return [
          {
            kind: "empty",
            label: "No dependency report",
            description: "Run 'NodeForge: Audit Dependencies' to populate"
          }
        ];
      }
      return [];
    }

    const r = this.report;
    if (!element) {
      const children: TreeNode[] = [];
      if (r.findings.length > 0) {
        const crit = r.findings.filter((f) => f.severity === "critical").length;
        const high = r.findings.filter((f) => f.severity === "high").length;
        const mod = r.findings.filter((f) => f.severity === "moderate").length;
        const low = r.findings.filter((f) => f.severity === "low").length;
        const parts: string[] = [];
        if (crit > 0) parts.push(`${crit} critical`);
        if (high > 0) parts.push(`${high} high`);
        if (mod > 0) parts.push(`${mod} moderate`);
        if (low > 0) parts.push(`${low} low`);
        children.push({
          kind: "section",
          label: "Vulnerabilities",
          description: parts.join(", "),
          tooltip: `${r.findings.length} vulnerabilities found`,
          section: "vulns"
        });
      } else {
        children.push({
          kind: "section",
          label: "Vulnerabilities",
          description: "none",
          tooltip: "No known vulnerabilities",
          section: "vulns"
        });
      }
      if (r.outdated.length > 0) {
        children.push({
          kind: "section",
          label: "Outdated",
          description: String(r.outdated.length),
          tooltip: `${r.outdated.length} outdated packages`,
          section: "outdated"
        });
      }
      return children;
    }

    if (element.kind === "section" && element.section === "vulns") {
      return r.findings.map((f, i) => toFindingNode(f, i));
    }
    if (element.kind === "section" && element.section === "outdated") {
      return r.outdated.map((o, i) => toOutdatedNode(o, i));
    }
    if (element.kind === "finding" && element.index !== undefined) {
      return findingDetails(r.findings[element.index]!);
    }
    if (element.kind === "outdated" && element.index !== undefined) {
      return outdatedDetails(r.outdated[element.index]!);
    }
    return [];
  }
}

function toFindingNode(f: DependencyFinding, index: number): TreeNode {
  return {
    kind: "finding",
    label: f.packageName,
    description: `${f.severity} — ${f.title}`,
    tooltip: `${f.packageName} (${f.severity})\n${f.title}\nAdvisory: ${f.advisory ?? "—"}\nURL: ${f.url ?? "—"}`,
    index
  };
}

function toOutdatedNode(o: OutdatedEntry, index: number): TreeNode {
  return {
    kind: "outdated",
    label: o.packageName,
    description: `${o.current} → ${o.latest} (${o.diff})`,
    tooltip: `Package: ${o.packageName}\nCurrent: ${o.current}\nWanted: ${o.wanted}\nLatest: ${o.latest}\nDiff: ${o.diff}\nType: ${o.dependencyType}`,
    index
  };
}

function findingDetails(f: DependencyFinding): TreeNode[] {
  const out: TreeNode[] = [
    detail("Severity", f.severity),
    detail("Title", f.title),
    detail("Installed", f.installed),
    detail("Recommended", f.recommended ?? "—"),
    detail("Advisory", f.advisory ?? "—"),
    detail("URL", f.url ?? "—"),
    detail("Type", f.dependencyType)
  ];
  return out;
}

function outdatedDetails(o: OutdatedEntry): TreeNode[] {
  return [
    detail("Current", o.current),
    detail("Wanted", o.wanted),
    detail("Latest", o.latest),
    detail("Diff", o.diff),
    detail("Type", o.dependencyType)
  ];
}

function detail(key: string, value: string): TreeNode {
  return {
    kind: "detail",
    label: `${key}:`,
    description: value,
    tooltip: `${key}: ${value}`,
    detailKey: key,
    detailValue: value
  };
}
