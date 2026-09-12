/**
 * DependencyGraphPanel — interactive dependency graph visualization.
 *
 * Opens a Webview panel showing the project's import graph as an interactive
 * SVG diagram. Click nodes to see details. Color-coded by node type (file
 * vs package) and edge type (static/dynamic/type import).
 *
 * Powered by `DependencyGraphAdapter.analyze()`.
 *
 * Usage:
 *   vscode.commands.registerCommand("nodeforge.showDependencyGraph", () => {
 *     DependencyGraphPanel.createOrShow(context, root);
 *   });
 */

import * as vscode from "vscode";
import { DependencyGraphAdapter } from "@nodeforge/adapter-dependency-graph";
import type { DependencyGraphAnalysis } from "@nodeforge/contracts";
import { logger } from "./Logger.js";

export class DependencyGraphPanel {
  public static readonly viewType = "nodeforge.dependencyGraph";
  private static instance: DependencyGraphPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private analysis: DependencyGraphAnalysis | undefined;

  private static async analyze(root: string): Promise<DependencyGraphAnalysis | undefined> {
    try {
      const adapter = new DependencyGraphAdapter();
      return await adapter.analyze(root);
    } catch (err) {
      logger.error("Dependency graph analysis failed", err);
      return undefined;
    }
  }

  public static async createOrShow(
    context: vscode.ExtensionContext,
    workspaceRoot: string
  ): Promise<void> {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it.
    if (DependencyGraphPanel.instance) {
      DependencyGraphPanel.instance.panel.reveal(column);
      return;
    }

    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
      DependencyGraphPanel.viewType,
      "NodeForge: Dependency Graph",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: []
      }
    );

    DependencyGraphPanel.instance = new DependencyGraphPanel(panel, context);

    // Run analysis and render.
    const analysis = await DependencyGraphPanel.analyze(workspaceRoot);
    if (analysis) {
      DependencyGraphPanel.instance.render(analysis);
    } else {
      DependencyGraphPanel.instance.renderError("Could not analyze dependency graph. Open a Node.js/TypeScript project and try again.");
    }
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext
  ) {
    this.panel = panel;

    // Set the initial HTML with a loading state.
    this.panel.webview.html = this.getLoadingHtml();

    // Listen for when the panel is disposed.
    this.panel.onDidDispose(() => {
      DependencyGraphPanel.instance = undefined;
    }, null, context.subscriptions);
  }

  private render(analysis: DependencyGraphAnalysis): void {
    this.analysis = analysis;
    this.panel.webview.html = this.getHtml(analysis);
  }

  private renderError(message: string): void {
    this.panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NodeForge: Dependency Graph</title>
<style>
  body { font-family: var(--vscode-font-family, sans-serif); padding: 24px; color: var(--vscode-foreground); }
  .error { color: var(--vscode-errorForeground); }
</style>
</head>
<body>
<h1>Dependency Graph</h1>
<p class="error">${message}</p>
</body>
</html>`;
  }

  private getLoadingHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>NodeForge: Dependency Graph</title>
<style>
  body { font-family: var(--vscode-font-family, sans-serif); padding: 24px; color: var(--vscode-foreground); }
</style>
</head>
<body>
<h1>Dependency Graph</h1>
<p>Analyzing imports...</p>
</body>
</html>`;
  }

  private getHtml(analysis: DependencyGraphAnalysis): string {
    // Build a simple SVG force-directed-style layout.
    // For simplicity, we use a layered layout (files on left, packages on right).
    const nodes = analysis.graph.nodes;
    const edges = analysis.graph.edges;

    // Position nodes in a grid.
    const fileNodes = nodes.filter((n) => n.kind === "file");
    const packageNodes = nodes.filter((n) => n.kind === "package");

    const nodePositions = new Map<string, { x: number; y: number }>();
    const nodeRadius = 24;
    const colWidth = 200;
    const rowHeight = 60;

    fileNodes.forEach((node, i) => {
      nodePositions.set(node.id, { x: 50, y: 50 + i * rowHeight });
    });
    packageNodes.forEach((node, i) => {
      nodePositions.set(node.id, { x: 50 + colWidth * 2, y: 50 + i * rowHeight });
    });

    const svgWidth = 600;
    const svgHeight = Math.max(fileNodes.length, packageNodes.length) * rowHeight + 100;

    // Build SVG content.
    const edgePaths = edges.map((edge) => {
      const from = nodePositions.get(edge.from);
      const to = nodePositions.get(edge.to);
      if (!from || !to) return "";
      const color = edge.kind === "type" ? "#888" : edge.kind === "dynamic" ? "#f59e0b" : "#3b82f6";
      return `<line x1="${from.x + nodeRadius}" y1="${from.y}" x2="${to.x - nodeRadius}" y2="${to.y}" stroke="${color}" stroke-width="1.5" opacity="0.6" />`;
    }).join("\n");

    const fileCircles = fileNodes.map((node) => {
      const pos = nodePositions.get(node.id)!;
      const label = node.name.length > 15 ? node.name.slice(0, 12) + "..." : node.name;
      return `
        <circle cx="${pos.x}" cy="${pos.y}" r="${nodeRadius}" fill="#3b82f6" stroke="#1e40af" stroke-width="2" />
        <text x="${pos.x}" y="${pos.y + 5}" text-anchor="middle" fill="white" font-size="10" font-family="monospace">${label}</text>
      `;
    }).join("\n");

    const packageCircles = packageNodes.map((node) => {
      const pos = nodePositions.get(node.id)!;
      const label = node.name.length > 15 ? node.name.slice(0, 12) + "..." : node.name;
      return `
        <circle cx="${pos.x}" cy="${pos.y}" r="${nodeRadius}" fill="#10b981" stroke="#047857" stroke-width="2" />
        <text x="${pos.x}" y="${pos.y + 5}" text-anchor="middle" fill="white" font-size="10" font-family="monospace">${label}</text>
      `;
    }).join("\n");

    // Summary stats.
    const unused = analysis.unused.filter((u) => !u.likelyFalsePositive);
    const unusedFP = analysis.unused.filter((u) => u.likelyFalsePositive);
    const circular = analysis.circular;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NodeForge: Dependency Graph</title>
<style>
  body {
    font-family: var(--vscode-font-family, sans-serif);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 16px;
    margin: 0;
  }
  h1 { font-size: 18px; margin: 0 0 16px 0; }
  h2 { font-size: 14px; margin: 16px 0 8px 0; color: var(--vscode-foreground); }
  .stats { display: flex; gap: 24px; margin-bottom: 16px; }
  .stat { background: var(--vscode-editor-inactive-selection); padding: 8px 16px; border-radius: 4px; }
  .stat-value { font-size: 20px; font-weight: bold; }
  .stat-label { font-size: 11px; color: var(--vscode-descriptionForeground); }
  .legend { display: flex; gap: 16px; margin-bottom: 12px; font-size: 12px; }
  .legend-item { display: flex; align-items: center; gap: 6px; }
  .legend-dot { width: 12px; height: 12px; border-radius: 50%; }
  .legend-line { width: 20px; height: 2px; }
  svg { background: var(--vscode-editor-inactive-selection); border-radius: 8px; }
  .warning { color: var(--vscode-editorWarning-foreground); }
  .error { color: var(--vscode-editorError-foreground); }
  ul { margin: 4px 0; padding-left: 20px; }
  li { margin: 2px 0; font-size: 12px; font-family: monospace; }
</style>
</head>
<body>
<h1>$(graph) Dependency Graph</h1>

<div class="stats">
  <div class="stat">
    <div class="stat-value">${nodes.length}</div>
    <div class="stat-label">Nodes</div>
  </div>
  <div class="stat">
    <div class="stat-value">${edges.length}</div>
    <div class="stat-label">Edges</div>
  </div>
  <div class="stat">
    <div class="stat-value">${analysis.unused.length}</div>
    <div class="stat-label">Unused Deps</div>
  </div>
  <div class="stat">
    <div class="stat-value ${circular.length > 0 ? "error" : ""}">${circular.length}</div>
    <div class="stat-label">Circular</div>
  </div>
</div>

<div class="legend">
  <div class="legend-item"><div class="legend-dot" style="background:#3b82f6"></div> Source File</div>
  <div class="legend-item"><div class="legend-dot" style="background:#10b981"></div> Package</div>
  <div class="legend-item"><div class="legend-line" style="background:#3b82f6"></div> Static Import</div>
  <div class="legend-item"><div class="legend-line" style="background:#f59e0b"></div> Dynamic Import</div>
  <div class="legend-item"><div class="legend-line" style="background:#888"></div> Type Import</div>
</div>

<svg width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg">
  ${edgePaths}
  ${fileCircles}
  ${packageCircles}
</svg>

${unused.length > 0 ? `<h2 class="warning">⚠️ Unused Dependencies (${unused.length})</h2>
<ul>${unused.map((u) => `<li>${u.packageName} (${u.version}) — ${u.dependencyType}</li>`).join("")}</ul>` : ""}

${unusedFP.length > 0 ? `<h2>Unused (Likely False Positives) (${unusedFP.length})</h2>
<p style="font-size:12px;color:var(--vscode-descriptionForeground)">These are commonly used as CLI tools, config plugins, or type definitions — not directly imported.</p>
<ul>${unusedFP.map((u) => `<li>${u.packageName} — ${u.falsePositiveReason ?? ""}</li>`).join("")}</ul>` : ""}

${circular.length > 0 ? `<h2 class="error">🔄 Circular Dependencies (${circular.length})</h2>
<ul>${circular.map((c) => `<li>${c.chain.map((n) => n.split("/").pop()).join(" → ")}</li>`).join("")}</ul>` : ""}

${analysis.missing.length > 0 ? `<h2 class="warning">❓ Missing Dependencies (${analysis.missing.length})</h2>
<ul>${analysis.missing.map((m) => `<li>${m.packageName} — imported by ${m.importedBy.join(", ")}</li>`).join("")}</ul>` : ""}

</body>
</html>`;
  }
}
