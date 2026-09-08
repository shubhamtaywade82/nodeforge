/**
 * Database schema contract — produced by Prisma / Drizzle / raw SQL adapters.
 */

export type ColumnType =
  | "integer"
  | "bigint"
  | "serial"
  | "text"
  | "varchar"
  | "boolean"
  | "timestamp"
  | "timestamptz"
  | "date"
  | "numeric"
  | "decimal"
  | "float"
  | "double"
  | "uuid"
  | "json"
  | "jsonb"
  | "enum"
  | "array"
  | "blob"
  | "unknown";

export interface Column {
  name: string;
  type: ColumnType;
  nullable: boolean;
  /** Default value, as a SQL literal string. */
  default?: string;
  isPrimaryKey: boolean;
  isUnique: boolean;
  /** For enums, the allowed values. */
  enumValues?: string[];
  /** Comment, if the schema source provides one. */
  comment?: string;
}

export interface Index {
  name: string;
  columns: string[];
  unique: boolean;
  /** Optional expression for partial / functional indexes. */
  partialExpression?: string;
}

export type RelationKind = "one-to-one" | "one-to-many" | "many-to-many";

export interface Relation {
  name: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  kind: RelationKind;
  /** Optional onDelete behavior, e.g. `CASCADE`, `SET NULL`. */
  onDelete?: string;
  /** Optional onUpdate behavior. */
  onUpdate?: string;
}

export interface Table {
  name: string;
  schema?: string;
  columns: Column[];
  indexes: Index[];
  comment?: string;
}

export interface DatabaseSchema {
  /** Connection identifier, e.g. `default` or a connection URL host. */
  connectionId: string;
  /** Database product, if known. */
  product?: "postgres" | "mysql" | "sqlite" | "mongodb" | "unknown";
  tables: Table[];
  relations: Relation[];
  /** Captured-at timestamp (ms since epoch). */
  capturedAt: number;
}
