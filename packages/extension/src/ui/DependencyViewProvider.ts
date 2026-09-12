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
import type {
  DependencyGraphAnalysis,
  DependencyReport,
  DependencyFinding,
  OutdatedEntry,
  UnusedDependency
} from "@nodeforge/contracts";

type NodeKind =
  | "root"
  | "section"
  | "finding"
  | "outdated"
  | "unused"
  | "circular"
  | "missing"
  | "detail"
  | "empty";

interface TreeNode {
  kind: NodeKind;
  label: string;
  description?: string;
  tooltip?: string;
  section?: "vulns" | "outdated" | "unused" | "circular" | "missing";
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
  private graph: DependencyGraphAnalysis | undefined;

  setReport(report: DependencyReport | undefined): void {
    this.report = report;
    this.emitter.fire(undefined);
  }

  setGraphAnalysis(analysis: DependencyGraphAnalysis | undefined): void {
    this.graph = analysis;
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
    } else if (element.kind === "outdated" || element.kind === "unused" || element.kind === "missing") {
      item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      item.iconPath = new vscode.ThemeIcon("arrow-circle-up");
    } else if (element.kind === "circular") {
      item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      item.iconPath = new vscode.ThemeIcon("sync");
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
    if (!element) {
      if (!this.report && !this.graph) {
        return [
          {
            kind: "empty",
            label: "No dependency data",
            description: "Run audit or analyze graph"
          }
        ];
      }
    }

    if (!this.report && element) {
      return this.graphChildren(element);
    }

    if (!this.report) {
      return element ? this.graphChildren(element) : this.graphRootSections();
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
      return [...children, ...this.graphRootSections()];
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
    const graphChildren = this.graphChildren(element);
    if (graphChildren.length > 0) return graphChildren;
    return [];
  }

  private graphRootSections(): TreeNode[] {
    if (!this.graph) return [];
    const g = this.graph;
    const sections: TreeNode[] = [];
    sections.push({
      kind: "section",
      label: "Unused",
      description: String(g.unused.length),
      section: "unused"
    });
    sections.push({
      kind: "section",
      label: "Circular",
      description: String(g.circular.length),
      section: "circular"
    });
    sections.push({
      kind: "section",
      label: "Missing",
      description: String(g.missing.length),
      section: "missing"
    });
    return sections;
  }

  private graphChildren(element: TreeNode): TreeNode[] {
    if (!this.graph) return [];
    const g = this.graph;

    if (element.kind === "section" && element.section === "unused") {
      return g.unused.map((u, i) => toUnusedNode(u, i));
    }
    if (element.kind === "section" && element.section === "circular") {
      return g.circular.map((c, i) => ({
        kind: "circular" as const,
        label: `Cycle ${i + 1}`,
        description: c.chain.join(" → "),
        tooltip: c.chain.join(" → "),
        index: i
      }));
    }
    if (element.kind === "section" && element.section === "missing") {
      return g.missing.map((m, i) => ({
        kind: "missing" as const,
        label: m.packageName,
        description: `${m.importedBy.length} file(s)`,
        tooltip: `Imported by:\n${m.importedBy.join("\n")}`,
        index: i
      }));
    }
    if (element.kind === "unused" && element.index !== undefined) {
      const u = g.unused[element.index]!;
      return [
        detail("Version", u.version),
        detail("Type", u.dependencyType),
        detail("False positive", u.likelyFalsePositive ? "likely" : "no"),
        detail("Reason", u.falsePositiveReason ?? "—")
      ];
    }
    return [];
  }
}

function toUnusedNode(u: UnusedDependency, index: number): TreeNode {
  return {
    kind: "unused",
    label: u.packageName,
    description: u.likelyFalsePositive ? "likely tooling" : "unused",
    tooltip: `${u.packageName}@${u.version} (${u.dependencyType})`,
    index
  };
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
