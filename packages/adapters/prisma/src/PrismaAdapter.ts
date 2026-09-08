/**
 * Prisma adapter.
 *
 * Parses a `schema.prisma` file into the normalized `DatabaseSchema` contract.
 *
 * The Prisma schema format is a custom DSL with blocks:
 *
 *   generator client {
 *     provider = "prisma-client-js"
 *   }
 *
 *   datasource db {
 *     provider = "postgresql"
 *     url      = env("DATABASE_URL")
 *   }
 *
 *   model User {
 *     id        String   @id @default(uuid())
 *     email     String   @unique
 *     role      Role     @default(USER)
 *     posts     Post[]
 *     profile   Profile?
 *
 *     @@index([email])
 *     @@map("users")
 *   }
 *
 *   enum Role {
 *     USER
 *     ADMIN
 *   }
 *
 * We parse this without using the `@prisma/sdk` runtime — that adds 30+ MB
 * of dependencies. A custom parser is small, fast, and self-contained.
 *
 * The parser handles:
 *   - `model` blocks with field declarations, attributes (@id, @unique,
 *     @default, @relation), and block-level directives (@@index, @@unique,
 *     @@map).
 *   - `enum` blocks with enum values.
 *   - `datasource` block (for database product detection).
 *   - Comments (`//` and `slash-star ... star-slash`) are stripped before parsing.
 */

import * as path from "node:path";
import {
  AdapterParseError,
  FileNotFoundError,
  type Column,
  type DatabaseSchema,
  type ColumnType,
  type Index,
  type Relation,
  type Table
} from "@nodeforge/contracts";

export interface PrismaAdapterOptions {
  /** Override the path to schema.prisma. If unset, adapter uses <root>/prisma/schema.prisma. */
  schemaPath?: string;
}

export class PrismaAdapter {
  constructor(private readonly options: PrismaAdapterOptions = {}) {}

  /**
   * Parse the Prisma schema at `workspaceRoot/prisma/schema.prisma` (or the
   * override path) into a `DatabaseSchema`. Throws `FileNotFoundError` if no
   * schema file exists, or `AdapterParseError` on parse failures.
   */
  async detect(workspaceRoot: string): Promise<DatabaseSchema> {
    const schemaPath = this.options.schemaPath ?? path.join(workspaceRoot, "prisma", "schema.prisma");
    const fs = await import("node:fs/promises");
    let raw: string;
    try {
      raw = await fs.readFile(schemaPath, "utf8");
    } catch (err) {
      if (isEnoent(err)) {
        throw new FileNotFoundError(schemaPath);
      }
      throw err;
    }
    return parsePrismaSchema(raw, schemaPath);
  }

  /**
   * Returns true if a `prisma/schema.prisma` file exists in `workspaceRoot`.
   */
  static async hasConfig(workspaceRoot: string): Promise<boolean> {
    const fs = await import("node:fs/promises");
    try {
      await fs.access(path.join(workspaceRoot, "prisma", "schema.prisma"));
      return true;
    } catch {
      return false;
    }
  }
}

interface ParsedBlock {
  type: "model" | "enum" | "datasource" | "generator";
  name: string;
  body: string;
}

/**
 * Parse Prisma schema source text into a `DatabaseSchema`.
 *
 * Exported for testing.
 */
export function parsePrismaSchema(source: string, sourcePath = "<unknown>"): DatabaseSchema {
  // Strip comments first.
  const cleaned = stripComments(source);
  const blocks = extractBlocks(cleaned);
  const product = detectProduct(blocks);

  // Build enum lookup: enum name -> values.
  const enumValues = new Map<string, string[]>();
  for (const block of blocks) {
    if (block.type === "enum") {
      enumValues.set(block.name, parseEnumValues(block.body));
    }
  }

  // Parse models.
  const tables: Table[] = [];
  const relations: Relation[] = [];
  for (const block of blocks) {
    if (block.type === "model") {
      const { table, modelRelations } = parseModelBlock(block, enumValues, sourcePath);
      tables.push(table);
      relations.push(...modelRelations);
    }
  }

  return {
    connectionId: "prisma",
    product,
    tables,
    relations,
    capturedAt: Date.now()
  };
}

/**
 * Strip `//` line comments and `slash-star block star-slash` from Prisma source.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\" && next) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      // Skip to end of line.
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      // Skip to closing */
      i += 2;
      while (i < source.length - 1 && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Extract top-level blocks (`model Foo { ... }`, `enum Bar { ... }`, etc.).
 *
 * Tracks brace nesting — block bodies can contain `{` in default values
 * (rare but possible). Returns blocks in source order.
 */
export function extractBlocks(source: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const blockKeywordRegex = /^(model|enum|datasource|generator)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/gm;

  let match: RegExpExecArray | null;
  while ((match = blockKeywordRegex.exec(source)) !== null) {
    const type = match[1] as ParsedBlock["type"];
    const name = match[2]!;
    const bodyStart = match.index + match[0].length;

    // Walk to find the matching closing brace.
    let depth = 1;
    let i = bodyStart;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      if (depth === 0) break;
      i++;
    }
    if (depth !== 0) {
      throw new AdapterParseError("prisma", `Unterminated ${type} block "${name}"`);
    }
    const body = source.slice(bodyStart, i);
    blocks.push({ type, name, body });
    // Continue scanning after the closing brace.
    blockKeywordRegex.lastIndex = i + 1;
  }
  return blocks;
}

function detectProduct(blocks: ParsedBlock[]): DatabaseSchema["product"] {
  const ds = blocks.find((b) => b.type === "datasource");
  if (!ds) return "unknown";
  const providerMatch = /provider\s*=\s*"([^"]+)"/.exec(ds.body);
  if (!providerMatch) return "unknown";
  switch (providerMatch[1]) {
    case "postgresql":
      return "postgres";
    case "mysql":
      return "mysql";
    case "sqlite":
      return "sqlite";
    case "mongodb":
      return "mongodb";
    default:
      return "unknown";
  }
}

function parseEnumValues(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"))
    .map((line) => line.split(/\s+/)[0]!)
    .filter((v) => v && v.length > 0);
}

/**
 * Parse a `model Foo { ... }` block into a `Table` plus any relations.
 *
 * Each non-empty line is one of:
 *   - A field declaration: `name Type @attr1 @attr2(args)`
 *   - A block-level directive: `@@index([col1, col2])` or `@@map("table_name")`
 */
function parseModelBlock(
  block: ParsedBlock,
  enumValues: Map<string, string[]>,
  sourcePath: string
): { table: Table; modelRelations: Relation[] } {
  const lines = block.body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const columns: Column[] = [];
  const indexes: Index[] = [];
  const relations: Relation[] = [];
  let tableName = block.name;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      // Block-level directive.
      const mapMatch = /@@map\("([^"]+)"\)/.exec(line);
      if (mapMatch) {
        tableName = mapMatch[1]!;
        continue;
      }
      const indexMatch = /@@index\(\[([^\]]+)\]/.exec(line);
      if (indexMatch) {
        const cols = indexMatch[1]!.split(",").map((c) => c.trim());
        indexes.push({
          name: `${tableName}_idx_${cols.join("_")}`,
          columns: cols,
          unique: false
        });
        continue;
      }
      const uniqueMatch = /@@unique\(\[([^\]]+)\]/.exec(line);
      if (uniqueMatch) {
        const cols = uniqueMatch[1]!.split(",").map((c) => c.trim());
        indexes.push({
          name: `${tableName}_uniq_${cols.join("_")}`,
          columns: cols,
          unique: true
        });
        continue;
      }
      // Unknown @@ directive — skip.
      continue;
    }

    // Field declaration.
    const parsed = parseFieldLine(line, enumValues);
    if (parsed) {
      // Skip placeholder columns (relation fields that don't become physical columns).
      if (parsed.column.type !== "unknown") {
        columns.push(parsed.column);
      }
      if (parsed.relation) {
        relations.push(parsed.relation);
      }
    }
  }

  const table: Table = {
    name: tableName,
    columns,
    indexes
  };

  // Patch relation table names — we know the from-table now, and the to-table
  // is the related model's name (which we set as its table name; this may be
  // patched again if the related model uses @@map).
  for (const rel of relations) {
    rel.fromTable = tableName;
    rel.toTable = block.name; // Use the model name as the to-table initially.
  }

  return { table, modelRelations: relations };
}

interface ParsedField {
  column: Column;
  relation: Relation | null;
}

function parseFieldLine(line: string, enumValues: Map<string, string[]>): ParsedField | null {
  // Tokenize: `name Type @attr(args) @attr2 ...`
  // First two tokens are name and type. The rest are attributes.
  const tokens = tokenizeField(line);
  if (tokens.length < 2) return null;
  const fieldName = tokens[0]!;
  let prismaType = tokens[1]!;
  const attrs = tokens.slice(2);

  // Detect relation fields: type is a model name with optional `[]` or `?`.
  // We approximate: if the type isn't a scalar, treat it as a relation.
  const isList = prismaType.endsWith("[]");
  if (isList) prismaType = prismaType.slice(0, -2);
  const isOptional = prismaType.endsWith("?");
  if (isOptional) prismaType = prismaType.slice(0, -1);

  const scalarType = mapPrismaTypeToColumnType(prismaType);
  const isEnum = enumValues.has(prismaType);

  // Default value from @default(...) attribute.
  let defaultValue: string | undefined;
  const defaultAttr = attrs.find((a) => a.startsWith("@default("));
  if (defaultAttr) {
    defaultValue = extractParenContents(defaultAttr);
  }

  // @id attribute.
  const isId = attrs.some((a) => a === "@id");
  // @unique attribute (single-column).
  const isUnique = isId || attrs.some((a) => a === "@unique");

  // @relation attribute — parse foreign key.
  let relation: Relation | null = null;
  const relationAttr = attrs.find((a) => a.startsWith("@relation("));
  if (relationAttr) {
    relation = parseRelationAttribute(
      fieldName,
      prismaType,
      isList,
      extractParenContents(relationAttr)
    );
  }

  // If the type isn't a scalar AND isn't an enum, this is a relation field.
  // We don't include relation fields as columns — they're virtual.
  if (scalarType === "unknown" && !isEnum) {
    // Skip relation fields — they don't become physical columns.
    return { column: skipColumn(fieldName), relation };
  }

  const column: Column = {
    name: fieldName,
    type: isEnum ? "enum" : scalarType,
    nullable: !isId && isOptional,
    isPrimaryKey: isId,
    isUnique,
    default: defaultValue,
    enumValues: isEnum ? enumValues.get(prismaType) : undefined
  };

  return { column, relation };
}

/** Build a placeholder column that the caller can filter out. */
function skipColumn(name: string): Column {
  return {
    name,
    type: "unknown",
    nullable: true,
    isPrimaryKey: false,
    isUnique: false
  };
}

/**
 * Tokenize a Prisma field line into [name, type, attr1, attr2, ...].
 *
 * Attributes can have parentheses with arguments, possibly nested. We track
 * paren depth so that `@relation(fields: [authorId], references: [id])` stays
 * as a single token.
 */
function tokenizeField(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === " " && depth === 0) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function extractParenContents(attr: string): string {
  const open = attr.indexOf("(");
  const close = attr.lastIndexOf(")");
  if (open === -1 || close === -1) return "";
  return attr.slice(open + 1, close);
}

/**
 * Parse the contents of a `@relation(...)` attribute.
 *
 * Supported forms:
 *   @relation(fields: [authorId], references: [id])
 *   @relation(fields: [userId], references: [id], onDelete: Cascade)
 *   @relation("name", fields: [x], references: [y])
 */
function parseRelationAttribute(
  _fieldName: string,
  relatedModel: string,
  isList: boolean,
  body: string
): Relation | null {
  // The first segment before the first comma, if it's a quoted string, is the relation name.
  let relationName: string | undefined;
  let rest = body.trim();
  if (rest.startsWith('"')) {
    const closeQuote = rest.indexOf('"', 1);
    if (closeQuote > 0) {
      relationName = rest.slice(1, closeQuote);
      rest = rest.slice(closeQuote + 1).replace(/^\s*,\s*/, "");
    }
  }

  // Extract fields: [...] and references: [...] arrays.
  const fieldsMatch = /fields:\s*\[([^\]]+)\]/.exec(rest);
  const referencesMatch = /references:\s*\[([^\]]+)\]/.exec(rest);
  if (!fieldsMatch || !referencesMatch) {
    // Self-relation or implicit many-to-many — skip for now.
    return null;
  }

  const fromColumn = fieldsMatch[1]!.split(",")[0]!.trim();
  const toColumn = referencesMatch[1]!.split(",")[0]!.trim();

  // Detect onDelete behavior.
  let onDelete: string | undefined;
  const onDeleteMatch = /onDelete:\s*(\w+)/.exec(rest);
  if (onDeleteMatch) onDelete = onDeleteMatch[1];

  return {
    name: relationName ?? `${relatedModel}_${fromColumn}_${toColumn}`,
    fromTable: "", // Filled in by the caller (we don't know the table name here yet)
    fromColumn,
    toTable: "", // Filled in by the caller
    toColumn,
    kind: isList ? "one-to-many" : "one-to-one",
    onDelete
  };
}

/**
 * Map a Prisma scalar type to our ColumnType union. Returns "unknown" for
 * model references (which indicates a relation field, not a column).
 */
function mapPrismaTypeToColumnType(prismaType: string): ColumnType {
  switch (prismaType) {
    case "String":
      return "varchar";
    case "Int":
      return "integer";
    case "BigInt":
      return "bigint";
    case "Boolean":
      return "boolean";
    case "Float":
      return "float";
    case "Decimal":
      return "decimal";
    case "DateTime":
      return "timestamptz";
    case "Json":
      return "jsonb";
    case "Bytes":
      return "blob";
    case "Unsupported":
      return "unknown";
    default:
      // Likely a model name (relation) or an enum name.
      // Callers should handle "unknown" by checking the enum lookup.
      return "unknown";
  }
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "ENOENT";
}
