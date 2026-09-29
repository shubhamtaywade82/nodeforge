import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { NodeForgeContext } from "../src/NodeForgeContext.js";

describe("NodeForgeContext resource paths", () => {
  it("reads a file inside the workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nodeforge-safe-path-"));
    try {
      await writeFile(path.join(root, "package.json"), "{}\n", "utf8");
      const ctx = new NodeForgeContext(root);

      await expect(ctx.readConfigFile("package.json")).resolves.toBe("{}\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects parent traversal", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nodeforge-safe-path-"));
    try {
      const ctx = new NodeForgeContext(root);

      await expect(ctx.readConfigFile("../outside.txt")).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not expose unlisted or secret-bearing files as resources", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nodeforge-safe-resource-"));
    try {
      await writeFile(path.join(root, ".env"), "TOKEN=secret\n", "utf8");
      await writeFile(path.join(root, "secret.txt"), "secret\n", "utf8");

      const ctx = new NodeForgeContext(root);

      await expect(ctx.readConfigFile(".env")).resolves.toBeUndefined();
      await expect(ctx.readConfigFile("secret.txt")).resolves.toBeUndefined();
      await expect(ctx.listConfigFiles()).resolves.not.toContainEqual(
        expect.objectContaining({ path: ".env" })
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a symlink that resolves outside the workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nodeforge-safe-path-"));
    const outside = await mkdtemp(path.join(tmpdir(), "nodeforge-outside-"));
    try {
      await writeFile(path.join(outside, "secret.json"), "secret\n", "utf8");
      await symlink(path.join(outside, "secret.json"), path.join(root, "package.json"));
      const ctx = new NodeForgeContext(root);

      await expect(ctx.readConfigFile("package.json")).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("does not expose outside symlinks from config resources", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nodeforge-safe-path-"));
    const outside = await mkdtemp(path.join(tmpdir(), "nodeforge-outside-"));
    try {
      await mkdir(path.join(root, ".github"), { recursive: true });
      await writeFile(path.join(root, "package.json"), "{}\n", "utf8");
      await writeFile(path.join(outside, "README.md"), "external\n", "utf8");
      await symlink(path.join(outside, "README.md"), path.join(root, "README.md"));

      const ctx = new NodeForgeContext(root);
      const files = await ctx.listConfigFiles();

      expect(files.map((file) => file.path)).not.toContain("README.md");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
