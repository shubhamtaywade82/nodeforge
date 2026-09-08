/**
 * Drizzle adapter.
 *
 * Parses Drizzle ORM schema files (TypeScript) into the normalized
 * `DatabaseSchema` contract.
 *
 * Drizzle schemas are TypeScript files that call `pgTable()`, `mysqlTable()`,
 * or `sqliteTable()` to define tables, and `pgEnum()` to define enums. The
 * column type is inferred from the helper function used (`serial`, `varchar`,
 * `integer`, `boolean`, etc.).
 *
 * For v0.0.x we use a regex-based parser rather than the TypeScript compiler
 * API. This handles the common patterns:
 *
 *   export const users = pgTable("users", {
 *     id: serial("id").primaryKey(),
 *     email: varchar("email", { length: 255 }).notNull().unique(),
 *     role: userRole("role").default("USER").notNull(),
 *     createdAt: timestamp("created_at").defaultNow().notNull()
 *   });
 *
 *   export const userRole = pgEnum("user_role", ["USER", "ADMIN"]);
 *
 * The parser:
 *   1. Strips comments
 *   2. Finds all `pgEnum(...)` / `mysqlEnum(...)` / `sqliteEnum(...)` calls
 *   3. Finds all `*Table(...)` calls and extracts the table name + column block
 *   4. For each column line, parses the column name + type helper + modifiers
 *
 * Limitations (documented):
 *   - Relations are NOT parsed — Drizzle defines relations in a separate
 *     `relations()` call that references other tables by symbol, requiring
 *     cross-file analysis. The relations array in the result will be empty
 *     until we add proper TS AST parsing.
 *   - Indexes defined via `index("name").on(table.col)` are not yet parsed.
 *   - Custom column types are mapped to "unknown".
 */

import * as path from "node:path";
import {
  AdapterParseError,
  FileNotFoundError,
  type Column,
  type ColumnType,
  type DatabaseSchema,
  type Table
} from "@nodeforge/contracts";

export interface DrizzleAdapterOptions {
  /** Override path to drizzle.config.ts. If unset, adapter uses <root>/drizzle.config.ts. */
  configPath?: string;
  /** Override schema glob. If unset, adapter reads the schema field from drizzle.config.ts. */
  schemaGlob?: string;
}

export class DrizzleAdapter {
  constructor(private readonly options: DrizzleAdapterOptions = {}) {}

  /**
   * Detect the Drizzle schema for `workspaceRoot` and parse it into a
   * `DatabaseSchema`. Throws `FileNotFoundError` if no `drizzle.config.ts`
   * exists, or `AdapterParseError` on parse failures.
   */
  async detect(workspaceRoot: string): Promise<DatabaseSchema> {
    const configPath = this.options.configPath ?? path.join(workspaceRoot, "drizzle.config.ts");
    const fs = await import("node:fs/promises");
    let configRaw: string;
    try {
      configRaw = await fs.readFile(configPath, "utf8");
    } catch (err) {
      if (isEnoent(err)) {
        throw new FileNotFoundError(configPath);
      }
      throw err;
    }

    const schemaGlob = this.options.schemaGlob ?? extractSchemaGlob(configRaw) ?? "./schema/*";
    const schemaFiles = await resolveSchemaFiles(workspaceRoot, schemaGlob);

    const tables: Table[] = [];
    const enumLookup = new Map<string, string[]>();
    const dialect = extractDialect(configRaw);

    // Pass 1: collect all enums first so column parsing can resolve them.
    // We index by BOTH the JS identifier (used as the column type helper)
    // and the SQL enum name (used in migrations).
    for (const file of schemaFiles) {
      const raw = await fs.readFile(file, "utf8");
      const cleaned = stripComments(raw);
      const fileEnums = parseEnums(cleaned);
      for (const e of fileEnums) {
        enumLookup.set(e.identifier, e.values);
        enumLookup.set(e.name, e.values);
      }
    }

    // Pass 2: parse tables.
    for (const file of schemaFiles) {
      const raw = await fs.readFile(file, "utf8");
      const cleaned = stripComments(raw);
      const fileTables = parseTables(cleaned, enumLookup);
      tables.push(...fileTables);
    }

    return {
      connectionId: "drizzle",
      product: dialect ?? "unknown",
      tables,
      relations: [],
      capturedAt: Date.now()
    };
  }

  /**
   * Returns true if a `drizzle.config.ts` file exists in `workspaceRoot`.
   */
  static async hasConfig(workspaceRoot: string): Promise<boolean> {
    const fs = await import("node:fs/promises");
    const candidates = ["drizzle.config.ts", "drizzle.config.js", "drizzle.config.mjs"];
    for (const c of candidates) {
      try {
        await fs.access(path.join(workspaceRoot, c));
        return true;
      } catch {
        // continue
      }
    }
    return false;
  }
}

/**
 * Extract the `schema` field value from a `drizzle.config.ts` file.
 *
 * Matches patterns like:
 *   schema: "./schema/*"
 *   schema: "./schema"
 *   schema: ["./schema/users.ts", "./schema/posts.ts"]
 */
export function extractSchemaGlob(configSource: string): string | undefined {
  // String form
  const stringMatch = /schema:\s*["']([^"']+)["']/.exec(configSource);
  if (stringMatch) return stringMatch[1];
  // Array form — return the directory of the first entry
  const arrayMatch = /schema:\s*\[\s*["']([^"']+)["']/.exec(configSource);
  if (arrayMatch) {
    const first = arrayMatch[1]!;
    // If the entry is a file path, return its directory.
    const dir = path.dirname(first);
    return dir === "." ? first : `${dir}/*`;
  }
  return undefined;
}

/** Extract the `dialect` field from a drizzle.config.ts. */
export function extractDialect(configSource: string): DatabaseSchema["product"] {
  const match = /dialect:\s*["'](\w+)["']/.exec(configSource);
  if (!match) return "unknown";
  switch (match[1]) {
    case "postgresql":
      return "postgres";
    case "mysql":
      return "mysql";
    case "sqlite":
      return "sqlite";
    default:
      return "unknown";
  }
}

interface ParsedEnum {
  /** JS identifier (e.g. `userRole`). */
  identifier: string;
  /** SQL enum name (e.g. `user_role`). */
  name: string;
  values: string[];
}

/**
 * Parse all `pgEnum("name", ["A", "B"])` / `mysqlEnum(...)` / `sqliteEnum(...)`
 * calls from cleaned Drizzle source.
 *
 * Each call is preceded by `export const <identifier> = `, which we use to
 * map the JS identifier (used as the column type helper) to the enum values.
 */
export function parseEnums(source: string): ParsedEnum[] {
  const out: ParsedEnum[] = [];
  // Match: [export const <identifier> =] pgEnum("name", ["A", "B", "C"])
  const regex = /(?:export\s+const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*)?(?:pgEnum|mysqlEnum|sqliteEnum)\s*\(\s*["']([^"']+)["']\s*,\s*\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(source)) !== null) {
    const identifier = m[1] ?? m[2]!;
    const name = m[2]!;
    const valuesRaw = m[3]!;
    const values = valuesRaw
      .split(",")
      .map((v) => v.trim().replace(/^["']|["']$/g, ""))
      .filter((v) => v.length > 0);
    out.push({ identifier, name, values });
  }
  return out;
}

/**
 * Parse all `pgTable("name", { ... })` / `mysqlTable(...)` / `sqliteTable(...)`
 * calls from cleaned Drizzle source.
 */
export function parseTables(source: string, enumLookup: Map<string, string[]>): Table[] {
  const tables: Table[] = [];

  // Match: <name>Table("table_name", { <columns> })
  // We use a custom walker that tracks brace depth so nested objects (like
  // `{ length: 255 }` inside `varchar(...)`) don't trip us up.
  const tableCallRegex = /(?:pgTable|mysqlTable|sqliteTable)\s*\(\s*["']([^"']+)["']\s*,\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = tableCallRegex.exec(source)) !== null) {
    const tableName = match[1]!;
    const bodyStart = match.index + match[0].length;
    const bodyEnd = findMatchingBrace(source, bodyStart - 1);
    if (bodyEnd === -1) {
      throw new AdapterParseError("drizzle", `Unterminated table block for "${tableName}"`);
    }
    const body = source.slice(bodyStart, bodyEnd);
    const columns = parseColumnBlock(body, enumLookup);
    tables.push({
      name: tableName,
      columns,
      indexes: []
    });
    // Continue scanning after this table.
    tableCallRegex.lastIndex = bodyEnd + 1;
  }
  return tables;
}

/** Find the index of the closing `}` that matches the opening `{` at `openPos`. */
function findMatchingBrace(source: string, openPos: number): number {
  let depth = 1;
  let i = openPos + 1;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Parse the body of a `pgTable("name", { ... })` block into columns.
 *
 * Each line is `name: type("sql_name").modifier()...`:
 *   id: serial("id").primaryKey(),
 *   email: varchar("email", { length: 255 }).notNull().unique(),
 *   role: userRole("role").default("USER").notNull(),
 */
function parseColumnBlock(body: string, enumLookup: Map<string, string[]>): Column[] {
  const columns: Column[] = [];
  // Split on commas at depth 0 (so commas inside `{ length: 255 }` don't split).
  const lines = splitOnTopLevelCommas(body);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const col = parseColumnLine(trimmed, enumLookup);
    if (col) columns.push(col);
  }
  return columns;
}

function splitOnTopLevelCommas(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of source) {
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function parseColumnLine(line: string, enumLookup: Map<string, string[]>): Column | null {
  // Pattern: `name: typeHelper("sql_name", { ... }).modifiers()`
  // We need: name, typeHelper, sql_name (the quoted string), and modifiers.
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line);
  if (!match) return null;
  const fieldName = match[1]!;
  const typeHelper = match[2]!;

  // Extract the first quoted string after the opening paren — that's the SQL column name.
  // We start searching after the match end.
  const afterType = line.slice(match[0].length);
  const sqlNameMatch = /^\s*["']([^"']+)["']/.exec(afterType);
  const sqlName = sqlNameMatch ? sqlNameMatch[1]! : fieldName;

  // Detect modifiers: .notNull(), .primaryKey(), .unique(), .default(...)
  const isPrimaryKey = /\.primaryKey\(\)/.test(line);
  const isUnique = /\.unique\(\)/.test(line);
  const isNotNull = /\.notNull\(\)/.test(line);

  // Extract default value
  const defaultMatch = /\.default\(\s*([^)]+)\)/.exec(line);
  const defaultValue = defaultMatch ? defaultMatch[1]!.trim() : undefined;

  // Determine column type
  const isEnum = enumLookup.has(typeHelper);
  const columnType: ColumnType = isEnum ? "enum" : mapDrizzleType(typeHelper);

  return {
    name: sqlName,
    type: columnType,
    nullable: !isPrimaryKey && !isNotNull,
    isPrimaryKey,
    isUnique,
    default: defaultValue,
    enumValues: isEnum ? enumLookup.get(typeHelper) : undefined
  };
}

function mapDrizzleType(helper: string): ColumnType {
  switch (helper) {
    case "serial":
    case "integer":
    case "int":
    case "int4":
      return "integer";
    case "bigserial":
    case "bigint":
      return "bigint";
    case "smallint":
    case "int2":
      return "integer";
    case "real":
    case "float4":
      return "float";
    case "doublePrecision":
    case "float8":
      return "double";
    case "numeric":
    case "decimal":
      return "decimal";
    case "varchar":
    case "char":
    case "bpchar":
      return "varchar";
    case "text":
      return "text";
    case "boolean":
    case "bool":
      return "boolean";
    case "timestamp":
      return "timestamp";
    case "timestamptz":
      return "timestamptz";
    case "date":
      return "date";
    case "uuid":
      return "uuid";
    case "json":
      return "json";
    case "jsonb":
      return "jsonb";
    case "bytea":
    case "blob":
      return "blob";
    default:
      return "unknown";
  }
}

/**
 * Strip `//` line comments and block comments from TypeScript source.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  let inTemplate = false;
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
    if (inTemplate) {
      out += ch;
      if (ch === "\\" && next) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === "`") inTemplate = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
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

async function resolveSchemaFiles(workspaceRoot: string, glob: string): Promise<string[]> {
  const fs = await import("node:fs/promises");
  const absoluteGlob = path.resolve(workspaceRoot, glob);
  const dir = path.dirname(absoluteGlob);
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(".ts") || name.endsWith(".js") || name.endsWith(".mjs"))
    .map((name) => path.join(dir, name))
    .sort();
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "ENOENT";
}
