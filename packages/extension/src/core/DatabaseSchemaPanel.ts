/**
 * DatabaseSchemaPanel — interactive ER diagram visualization.
 *
 * Opens a Webview panel showing the database schema as an Entity-Relationship
 * diagram. Tables are rendered as boxes with columns listed inside, and
 * relations drawn as lines between tables.
 *
 * Powered by `DatabaseManager.detect()` (which uses Prisma or Drizzle adapter).
 *
 * Usage:
 *   vscode.commands.registerCommand("nodeforge.showDatabaseSchema", () => {
 *     DatabaseSchemaPanel.createOrShow(context, root, schema);
 *   });
 */

import * as vscode from "vscode";
import type { DatabaseSchema, Table, Relation } from "@nodeforge/contracts";

export class DatabaseSchemaPanel {
  public static readonly viewType = "nodeforge.databaseSchema";
  private static instance: DatabaseSchemaPanel | undefined;

  public static async createOrShow(
    context: vscode.ExtensionContext,
    schema: DatabaseSchema
  ): Promise<void> {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (DatabaseSchemaPanel.instance) {
      DatabaseSchemaPanel.instance.panel.reveal(column);
      DatabaseSchemaPanel.instance.render(schema);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      DatabaseSchemaPanel.viewType,
      "NodeForge: Database Schema",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: []
      }
    );

    DatabaseSchemaPanel.instance = new DatabaseSchemaPanel(panel, context);
    DatabaseSchemaPanel.instance.render(schema);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext
  ) {
    this.panel.onDidDispose(() => {
      DatabaseSchemaPanel.instance = undefined;
    }, null, context.subscriptions);
  }

  private render(schema: DatabaseSchema): void {
    this.panel.webview.html = this.getHtml(schema);
  }

  private getHtml(schema: DatabaseSchema): string {
    // Layout tables in a grid.
    const tables = schema.tables;
    const tableWidth = 200;
    const rowHeight = 18;
    const headerHeight = 28;
    const padding = 16;
    const gapX = 80;
    const gapY = 40;
    const cols = Math.ceil(Math.sqrt(tables.length));

    const tablePositions = new Map<string, { x: number; y: number }>();
    tables.forEach((table, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = padding + col * (tableWidth + gapX);
      const y = padding + row * (tableHeight(table) + gapY);
      tablePositions.set(table.name, { x, y });
    });

    function tableHeight(table: Table): number {
      return headerHeight + table.columns.length * rowHeight + 8;
    }

    const svgWidth = padding * 2 + cols * (tableWidth + gapX);
    const svgHeight = padding * 2 + Math.ceil(tables.length / cols) * (200 + gapY);

    const tableSvg = tables.map((table) => {
      const pos = tablePositions.get(table.name)!;
      const height = tableHeight(table);
      const isPk = (col: Table["columns"][number]) => col.isPrimaryKey ? "🔑 " : "";
      const isFk = (col: Table["columns"][number]) => col.isUnique && !col.isPrimaryKey ? "📌 " : "";
      const nullable = (col: Table["columns"][number]) => col.nullable ? " ○" : " ●";

      return `
        <rect x="${pos.x}" y="${pos.y}" width="${tableWidth}" height="${height}" rx="6"
              fill="var(--vscode-editor-background)" stroke="var(--vscode-focusBorder)" stroke-width="1.5" />
        <rect x="${pos.x}" y="${pos.y}" width="${tableWidth}" height="${headerHeight}" rx="6"
              fill="var(--vscode-editor-inactive-selection)" />
        <text x="${pos.x + 8}" y="${pos.y + 18}" fill="var(--vscode-foreground)" font-size="13" font-weight="bold">${table.name}</text>
        ${table.columns.map((col, i) => {
          const y = pos.y + headerHeight + 8 + i * rowHeight;
          return `<text x="${pos.x + 8}" y="${y + 12}" fill="var(--vscode-foreground)" font-size="11" font-family="monospace">${isPk(col)}${isFk(col)}${col.name}</text>
                  <text x="${pos.x + tableWidth - 8}" y="${y + 12}" text-anchor="end" fill="var(--vscode-descriptionForeground)" font-size="10" font-family="monospace">${col.type}${nullable(col)}</text>`;
        }).join("")}
      `;
    }).join("\n");

    // Draw relation lines.
    const relationSvg = schema.relations.map((rel) => {
      const from = tablePositions.get(rel.fromTable);
      const to = tablePositions.get(rel.toTable);
      if (!from || !to) return "";
      // Draw an L-shaped line from the right of `from` to the left of `to`.
      const midX = (from.x + tableWidth + to.x) / 2;
      return `<path d="M ${from.x + tableWidth} ${from.y + headerHeight / 2} L ${midX} ${from.y + headerHeight / 2} L ${midX} ${to.y + headerHeight / 2} L ${to.x} ${to.y + headerHeight / 2}"
                   fill="none" stroke="#f59e0b" stroke-width="1.5" opacity="0.5" stroke-dasharray="4 2" />
              <text x="${midX}" y="${(from.y + to.y) / 2}" text-anchor="middle" fill="var(--vscode-descriptionForeground)" font-size="9">${rel.kind}</text>`;
    }).join("\n");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NodeForge: Database Schema</title>
<style>
  body {
    font-family: var(--vscode-font-family, sans-serif);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 16px;
    margin: 0;
  }
  h1 { font-size: 18px; margin: 0 0 16px 0; }
  .stats { display: flex; gap: 24px; margin-bottom: 16px; }
  .stat { background: var(--vscode-editor-inactive-selection); padding: 8px 16px; border-radius: 4px; }
  .stat-value { font-size: 20px; font-weight: bold; }
  .stat-label { font-size: 11px; color: var(--vscode-descriptionForeground); }
  svg { background: var(--vscode-editor-inactive-selection); border-radius: 8px; }
  .legend { display: flex; gap: 16px; margin-bottom: 12px; font-size: 12px; }
  .legend-item { display: flex; align-items: center; gap: 6px; }
</style>
</head>
<body>
<h1>$(database) Database Schema</h1>

<div class="stats">
  <div class="stat">
    <div class="stat-value">${tables.length}</div>
    <div class="stat-label">Tables</div>
  </div>
  <div class="stat">
    <div class="stat-value">${tables.reduce((sum, t) => sum + t.columns.length, 0)}</div>
    <div class="stat-label">Columns</div>
  </div>
  <div class="stat">
    <div class="stat-value">${schema.relations.length}</div>
    <div class="stat-label">Relations</div>
  </div>
  <div class="stat">
    <div class="stat-value">${schema.product ?? "—"}</div>
    <div class="stat-label">Database</div>
  </div>
</div>

<div class="legend">
  <div class="legend-item">🔑 Primary Key</div>
  <div class="legend-item">📌 Unique</div>
  <div class="legend-item">● Not Null</div>
  <div class="legend-item">○ Nullable</div>
</div>

<svg width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg">
  ${relationSvg}
  ${tableSvg}
</svg>

</body>
</html>`;
  }
}
