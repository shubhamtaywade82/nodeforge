/**
 * Tests for the Drizzle adapter.
 */

import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DrizzleAdapter,
  parseEnums,
  parseTables,
  stripComments,
  extractSchemaGlob,
  extractDialect
} from "../src/DrizzleAdapter.js";

const FIXTURE = path.resolve(__dirname, "../../../test-fixtures/node-ts-drizzle");

describe("stripComments", () => {
  it("strips line comments", () => {
    expect(stripComments("// hello\nconst x = 1;")).toBe("\nconst x = 1;");
  });

  it("strips block comments", () => {
    expect(stripComments("/* hello */ const x = 1;")).toBe(" const x = 1;");
  });

  it("preserves strings containing slashes", () => {
    expect(stripComments('const url = "http://example.com";')).toContain('"http://example.com"');
  });
});

describe("extractSchemaGlob", () => {
  it("extracts string schema field", () => {
    const src = 'export default defineConfig({ schema: "./schema/*" });';
    expect(extractSchemaGlob(src)).toBe("./schema/*");
  });

  it("extracts from array schema field", () => {
    const src = 'export default defineConfig({ schema: ["./schema/users.ts", "./schema/posts.ts"] });';
    expect(extractSchemaGlob(src)).toBe("./schema/*");
  });

  it("returns undefined when no schema field", () => {
    expect(extractSchemaGlob("export default defineConfig({});")).toBeUndefined();
  });
});

describe("extractDialect", () => {
  it("detects postgresql", () => {
    expect(extractDialect('dialect: "postgresql"')).toBe("postgres");
  });
  it("detects mysql", () => {
    expect(extractDialect('dialect: "mysql"')).toBe("mysql");
  });
  it("detects sqlite", () => {
    expect(extractDialect('dialect: "sqlite"')).toBe("sqlite");
  });
  it("returns unknown for missing dialect", () => {
    expect(extractDialect("")).toBe("unknown");
  });
});

describe("parseEnums", () => {
  it("parses pgEnum with identifier and SQL name", () => {
    const source = 'export const role = pgEnum("role", ["USER", "ADMIN", "MODERATOR"]);';
    const enums = parseEnums(source);
    expect(enums).toHaveLength(1);
    expect(enums[0]!.identifier).toBe("role");
    expect(enums[0]!.name).toBe("role");
    expect(enums[0]!.values).toEqual(["USER", "ADMIN", "MODERATOR"]);
  });

  it("parses pgEnum where identifier differs from SQL name", () => {
    const source = 'export const userRole = pgEnum("user_role", ["USER", "ADMIN"]);';
    const enums = parseEnums(source);
    expect(enums[0]!.identifier).toBe("userRole");
    expect(enums[0]!.name).toBe("user_role");
  });

  it("parses mysqlEnum", () => {
    const source = 'export const status = mysqlEnum("status", ["PENDING", "DONE"]);';
    const enums = parseEnums(source);
    expect(enums[0]!.name).toBe("status");
    expect(enums[0]!.values).toEqual(["PENDING", "DONE"]);
  });

  it("returns empty for no enums", () => {
    expect(parseEnums("const x = 1;")).toEqual([]);
  });
});

describe("parseTables", () => {
  it("parses a single table with columns", () => {
    const source = [
      'export const users = pgTable("users", {',
      '  id: serial("id").primaryKey(),',
      '  email: varchar("email", { length: 255 }).notNull().unique(),',
      "});"
    ].join("\n");
    const tables = parseTables(source, new Map());
    expect(tables).toHaveLength(1);
    expect(tables[0]!.name).toBe("users");
    expect(tables[0]!.columns).toHaveLength(2);
    expect(tables[0]!.columns[0]!.name).toBe("id");
    expect(tables[0]!.columns[0]!.type).toBe("integer");
    expect(tables[0]!.columns[0]!.isPrimaryKey).toBe(true);
    expect(tables[0]!.columns[1]!.name).toBe("email");
    expect(tables[0]!.columns[1]!.type).toBe("varchar");
    expect(tables[0]!.columns[1]!.nullable).toBe(false);
    expect(tables[0]!.columns[1]!.isUnique).toBe(true);
  });

  it("parses default values", () => {
    const source = [
      'export const t = pgTable("t", {',
      '  published: boolean("published").default(false).notNull(),',
      '  role: varchar("role").default("USER"),',
      "});"
    ].join("\n");
    const tables = parseTables(source, new Map());
    expect(tables[0]!.columns[0]!.default).toBe("false");
    expect(tables[0]!.columns[1]!.default).toBe('"USER"');
  });

  it("resolves enum columns from lookup", () => {
    const source = [
      'export const userRole = pgEnum("user_role", ["USER", "ADMIN"]);',
      'export const users = pgTable("users", {',
      '  role: userRole("role").default("USER").notNull(),',
      "});"
    ].join("\n");
    const enumLookup = new Map([["userRole", ["USER", "ADMIN"]]]);
    const tables = parseTables(source, enumLookup);
    const role = tables[0]!.columns[0]!;
    expect(role.type).toBe("enum");
    expect(role.enumValues).toEqual(["USER", "ADMIN"]);
  });

  it("parses multiple tables in one source", () => {
    const source = [
      'export const users = pgTable("users", {',
      '  id: serial("id").primaryKey(),',
      "});",
      'export const posts = pgTable("posts", {',
      '  id: serial("id").primaryKey(),',
      "});"
    ].join("\n");
    const tables = parseTables(source, new Map());
    expect(tables).toHaveLength(2);
    expect(tables.map((t) => t.name)).toEqual(["users", "posts"]);
  });

  it("maps various type helpers correctly", () => {
    const source = [
      'export const t = pgTable("t", {',
      '  a: text("a"),',
      '  b: integer("b"),',
      '  c: bigint("c", { mode: "number" }),',
      '  d: boolean("d"),',
      '  e: timestamp("e"),',
      '  f: uuid("f"),',
      '  g: jsonb("g"),',
      "});"
    ].join("\n");
    const cols = parseTables(source, new Map())[0]!.columns;
    expect(cols[0]!.type).toBe("text");
    expect(cols[1]!.type).toBe("integer");
    expect(cols[2]!.type).toBe("bigint");
    expect(cols[3]!.type).toBe("boolean");
    expect(cols[4]!.type).toBe("timestamp");
    expect(cols[5]!.type).toBe("uuid");
    expect(cols[6]!.type).toBe("jsonb");
  });
});

describe("DrizzleAdapter (integration against fixture)", () => {
  it("parses the real fixture schema", async () => {
    const adapter = new DrizzleAdapter();
    const schema = await adapter.detect(FIXTURE);

    // Should have 3 tables: users, posts, profiles
    expect(schema.tables.length).toBe(3);
    const names = schema.tables.map((t) => t.name).sort();
    expect(names).toEqual(["posts", "profiles", "users"]);

    // Users table should have id (PK), email (unique), role (enum)
    const users = schema.tables.find((t) => t.name === "users")!;
    expect(users).toBeDefined();
    const idCol = users.columns.find((c) => c.name === "id")!;
    expect(idCol.isPrimaryKey).toBe(true);
    expect(idCol.type).toBe("integer");

    const emailCol = users.columns.find((c) => c.name === "email")!;
    expect(emailCol.isUnique).toBe(true);
    expect(emailCol.nullable).toBe(false);

    const roleCol = users.columns.find((c) => c.name === "role")!;
    expect(roleCol.type).toBe("enum");
    expect(roleCol.enumValues).toEqual(["USER", "ADMIN", "MODERATOR"]);

    // Should detect postgres dialect
    expect(schema.product).toBe("postgres");
  });

  it("detects config presence via hasConfig", async () => {
    expect(await DrizzleAdapter.hasConfig(FIXTURE)).toBe(true);
    expect(await DrizzleAdapter.hasConfig(path.dirname(FIXTURE))).toBe(false);
  });

  it("throws FileNotFoundError when config is missing", async () => {
    const adapter = new DrizzleAdapter({ configPath: "/nonexistent/drizzle.config.ts" });
    await expect(adapter.detect(FIXTURE)).rejects.toThrow(/File not found/);
  });
});
