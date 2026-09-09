import { pgTable, serial, varchar, text, timestamp, boolean, integer, pgEnum } from "drizzle-orm/pg-core";

// pgEnum defines a Postgres enum
export const userRole = pgEnum("user_role", ["USER", "ADMIN", "MODERATOR"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 100 }),
  role: userRole("role").default("USER").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

export const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content"),
  published: boolean("published").default(false).notNull(),
  authorId: integer("author_id").notNull(),
  viewCount: integer("view_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull()
});

export const profiles = pgTable("profiles", {
  id: serial("id").primaryKey(),
  bio: text("bio"),
  userId: integer("user_id").notNull().unique()
});
