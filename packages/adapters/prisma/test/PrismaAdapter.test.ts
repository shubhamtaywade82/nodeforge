/**
 * Tests for the Prisma adapter.
 *
 * Includes pure-parser unit tests (using the fixture schema source directly)
 * and an integration test that detects against the real fixture repo.
 */

import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";

import {
  PrismaAdapter,
  parsePrismaSchema,
  stripComments,
  extractBlocks
} from "../src/PrismaAdapter.js";

const FIXTURE = path.resolve(__dirname, "../../../test-fixtures/node-ts-prisma");

describe("stripComments", () => {
  it("strips line comments", () => {
    const input = "model Foo {\n  // comment\n  id String @id\n}\n";
    const stripped = stripComments(input);
    expect(stripped).not.toContain("// comment");
    expect(stripped).toContain("id String @id");
  });

  it("strips block comments", () => {
    const input = "model Foo {\n  /* block */\n  id String @id\n}\n";
    const stripped = stripComments(input);
    expect(stripped).not.toContain("/* block */");
    expect(stripped).toContain("id String @id");
  });

  it("preserves strings containing slashes", () => {
    const input = 'model Foo {\n  url String @default("http://example.com")\n}\n';
    const stripped = stripComments(input);
    expect(stripped).toContain('"http://example.com"');
  });
});

describe("extractBlocks", () => {
  it("extracts model and enum blocks", () => {
    const source = [
      "model User {",
      "  id String @id",
      "}",
      "",
      "enum Role {",
      "  USER",
      "  ADMIN",
      "}"
    ].join("\n");
    const blocks = extractBlocks(source);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.type).toBe("model");
    expect(blocks[0]!.name).toBe("User");
    expect(blocks[1]!.type).toBe("enum");
    expect(blocks[1]!.name).toBe("Role");
  });

  it("extracts datasource and generator blocks", () => {
    const source = [
      'generator client {',
      '  provider = "prisma-client-js"',
      "}",
      "",
      'datasource db {',
      '  provider = "postgresql"',
      '  url = env("DATABASE_URL")',
      "}"
    ].join("\n");
    const blocks = extractBlocks(source);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.type).toBe("generator");
    expect(blocks[1]!.type).toBe("datasource");
  });
});

describe("parsePrismaSchema (pure parser)", () => {
  it("parses a simple model with primary key", () => {
    const schema = [
      "model User {",
      "  id String @id @default(uuid())",
      "  email String @unique",
      "}"
    ].join("\n");
    const result = parsePrismaSchema(schema);
    expect(result.tables).toHaveLength(1);
    const user = result.tables[0]!;
    expect(user.name).toBe("User");
    expect(user.columns).toHaveLength(2);
    expect(user.columns[0]!.name).toBe("id");
    expect(user.columns[0]!.isPrimaryKey).toBe(true);
    expect(user.columns[0]!.type).toBe("varchar");
    expect(user.columns[0]!.default).toBe('uuid()');
    expect(user.columns[1]!.name).toBe("email");
    expect(user.columns[1]!.isUnique).toBe(true);
  });

  it("detects postgres product from datasource", () => {
    const schema = [
      'datasource db {',
      '  provider = "postgresql"',
      '}',
      "model Foo {",
      "  id String @id",
      "}"
    ].join("\n");
    const result = parsePrismaSchema(schema);
    expect(result.product).toBe("postgres");
  });

  it("parses enum values", () => {
    const schema = [
      "model User {",
      "  id String @id",
      "  role Role @default(USER)",
      "}",
      "enum Role {",
      "  USER",
      "  ADMIN",
      "  MODERATOR",
      "}"
    ].join("\n");
    const result = parsePrismaSchema(schema);
    const roleColumn = result.tables[0]!.columns.find((c) => c.name === "role");
    expect(roleColumn).toBeDefined();
    expect(roleColumn!.enumValues).toEqual(["USER", "ADMIN", "MODERATOR"]);
  });

  it("handles @@map to rename tables", () => {
    const schema = [
      "model User {",
      "  id String @id",
      '  @@map("users")',
      "}"
    ].join("\n");
    const result = parsePrismaSchema(schema);
    expect(result.tables[0]!.name).toBe("users");
  });

  it("parses @@index and @@unique directives", () => {
    const schema = [
      "model User {",
      "  id String @id",
      "  email String @unique",
      "  name String",
      "  @@index([name])",
      "  @@unique([email, name])",
      "}"
    ].join("\n");
    const result = parsePrismaSchema(schema);
    const user = result.tables[0]!;
    expect(user.indexes.length).toBeGreaterThanOrEqual(2);
    const uniqueIdx = user.indexes.find((i) => i.unique);
    expect(uniqueIdx).toBeDefined();
    expect(uniqueIdx!.columns).toEqual(["email", "name"]);
    const nonUniqueIdx = user.indexes.find((i) => !i.unique);
    expect(nonUniqueIdx!.columns).toEqual(["name"]);
  });

  it("parses @relation with fields and references", () => {
    const schema = [
      "model User {",
      "  id String @id",
      "  posts Post[]",
      "}",
      "model Post {",
      "  id String @id",
      "  authorId String",
      "  author User @relation(fields: [authorId], references: [id], onDelete: Cascade)",
      "}"
    ].join("\n");
    const result = parsePrismaSchema(schema);
    expect(result.relations.length).toBeGreaterThanOrEqual(1);
    const rel = result.relations[0]!;
    expect(rel.fromColumn).toBe("authorId");
    expect(rel.toColumn).toBe("id");
    expect(rel.onDelete).toBe("Cascade");
    expect(rel.kind).toBe("one-to-one"); // singular relation
  });
});

describe("PrismaAdapter (integration against fixture)", () => {
  it("parses the real fixture schema", async () => {
    const adapter = new PrismaAdapter();
    const schema = await adapter.detect(FIXTURE);

    // Should have 3 models: User, Post, Profile
    expect(schema.tables.length).toBe(3);
    const names = schema.tables.map((t) => t.name).sort();
    expect(names).toEqual(expect.arrayContaining(["users", "posts"]));

    // User table should be renamed via @@map("users")
    const userTable = schema.tables.find((t) => t.name === "users");
    expect(userTable).toBeDefined();
    expect(userTable!.columns.find((c) => c.name === "id")!.isPrimaryKey).toBe(true);
    expect(userTable!.columns.find((c) => c.name === "email")!.isUnique).toBe(true);
    expect(userTable!.columns.find((c) => c.name === "role")!.enumValues).toEqual(
      expect.arrayContaining(["USER", "ADMIN", "MODERATOR"])
    );

    // Should detect postgres product
    expect(schema.product).toBe("postgres");

    // Should have at least one relation (Post -> User)
    expect(schema.relations.length).toBeGreaterThanOrEqual(1);
  });

  it("detects prisma config presence via hasConfig", async () => {
    expect(await PrismaAdapter.hasConfig(FIXTURE)).toBe(true);
    expect(await PrismaAdapter.hasConfig(path.dirname(FIXTURE))).toBe(false);
  });

  it("throws FileNotFoundError when schema is missing", async () => {
    const adapter = new PrismaAdapter({ schemaPath: "/nonexistent/schema.prisma" });
    await expect(adapter.detect(FIXTURE)).rejects.toThrow(/File not found/);
  });
});
