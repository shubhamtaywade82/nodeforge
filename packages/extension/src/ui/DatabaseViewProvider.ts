/**
 * Database sidebar — renders a `DatabaseSchema` as a tree:
 *
 *   Database (postgres)
 *   ├─ users
 *   │   ├─ id (integer, PK)
 *   │   ├─ email (varchar, unique)
 *   │   ├─ role (enum: USER, ADMIN, MODERATOR)
 *   │   └─ indexes (2)
 *   ├─ posts
 *   │   └─ ...
 *   └─ relations
 *       └─ posts.authorId → users.id (one-to-one, onDelete: Cascade)
 */

import * as vscode from "vscode";
import type { DatabaseSchema, Column, Index, Relation, Table } from "@nodeforge/contracts";

type NodeKind = "root" | "table" | "column" | "index" | "relation" | "empty";

interface TreeNode {
  kind: NodeKind;
  label: string;
  description?: string;
  tooltip?: string;
  /** Children identifier (table name, "indexes", "relations"). */
  parentId?: string;
}

export class DatabaseViewProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  private schema: DatabaseSchema | undefined;

  setSchema(schema: DatabaseSchema | undefined): void {
    this.schema = schema;
    this.emitter.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label);
    item.description = element.description ?? "";
    if (element.tooltip) item.tooltip = element.tooltip;
    if (element.kind === "root" || element.kind === "table") {
      item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      item.iconPath = new vscode.ThemeIcon(element.kind === "root" ? "database" : "table");
    } else if (element.kind === "index" || element.kind === "relation") {
      item.collapsibleState = vscode.TreeItemCollapsibleState.None;
      item.iconPath = new vscode.ThemeIcon(element.kind === "index" ? "symbol-enum" : "link");
    } else if (element.kind === "column") {
      item.collapsibleState = vscode.TreeItemCollapsibleState.None;
      item.iconPath = new vscode.ThemeIcon("symbol-field");
    } else {
      item.collapsibleState = vscode.TreeItemCollapsibleState.None;
      item.iconPath = new vscode.ThemeIcon("info");
    }
    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!this.schema) {
      if (!element) {
        return [
          {
            kind: "empty",
            label: "No database detected",
            description: "Add Prisma or Drizzle to populate"
          }
        ];
      }
      return [];
    }

    const s = this.schema;

    if (!element) {
      const children: TreeNode[] = s.tables.map((t) => ({
        kind: "table" as const,
        label: t.name,
        description: `${t.columns.length} cols`,
        tooltip: `${t.name} (${t.columns.length} columns, ${t.indexes.length} indexes)`,
        parentId: t.name
      }));
      if (s.relations.length > 0) {
        children.push({
          kind: "table",
          label: "Relations",
          description: String(s.relations.length),
          tooltip: `${s.relations.length} foreign-key relations`,
          parentId: "__relations__"
        });
      }
      return children;
    }

    if (element.kind === "table") {
      if (element.parentId === "__relations__") {
        return s.relations.map((r) => toRelationNode(r));
      }
      const table = s.tables.find((t) => t.name === element.parentId);
      if (!table) return [];
      const children: TreeNode[] = table.columns.map((c) => toColumnNode(c));
      if (table.indexes.length > 0) {
        children.push({
          kind: "index",
          label: `Indexes (${table.indexes.length})`,
          description: "",
          tooltip: `${table.indexes.length} indexes on ${table.name}`,
          parentId: `__idx__${table.name}`
        });
      }
      return children;
    }

    if (element.kind === "index" && element.parentId?.startsWith("__idx__")) {
      const tableName = element.parentId.slice("__idx__".length);
      const table = s.tables.find((t) => t.name === tableName);
      if (!table) return [];
      return table.indexes.map((i) => toIndexNode(i));
    }

    return [];
  }
}

function toColumnNode(c: Column): TreeNode {
  const parts: string[] = [c.type];
  if (c.isPrimaryKey) parts.push("PK");
  if (c.isUnique) parts.push("unique");
  if (c.nullable) parts.push("nullable");
  if (c.default) parts.push(`default=${c.default}`);
  const desc = parts.join(", ");
  const tooltip = [
    `Column: ${c.name}`,
    `Type: ${c.type}`,
    `Nullable: ${c.nullable}`,
    `Primary Key: ${c.isPrimaryKey}`,
    `Unique: ${c.isUnique}`,
    c.default ? `Default: ${c.default}` : null,
    c.enumValues ? `Enum values: ${c.enumValues.join(", ")}` : null
  ]
    .filter(Boolean)
    .join("\n");
  return {
    kind: "column",
    label: c.name,
    description: desc,
    tooltip
  };
}

function toIndexNode(i: Index): TreeNode {
  return {
    kind: "index",
    label: i.name,
    description: `${i.unique ? "unique " : ""}${i.columns.join(", ")}`,
    tooltip: `Index: ${i.name}\nColumns: ${i.columns.join(", ")}\nUnique: ${i.unique}`
  };
}

function toRelationNode(r: Relation): TreeNode {
  const desc = `${r.fromTable}.${r.fromColumn} → ${r.toTable}.${r.toColumn}`;
  const tooltip = [
    `Relation: ${r.name}`,
    `From: ${r.fromTable}.${r.fromColumn}`,
    `To: ${r.toTable}.${r.toColumn}`,
    `Kind: ${r.kind}`,
    r.onDelete ? `On Delete: ${r.onDelete}` : null
  ]
    .filter(Boolean)
    .join("\n");
  return {
    kind: "relation",
    label: r.name,
    description: desc,
    tooltip
  };
}
