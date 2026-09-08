/**
 * Tests for the workspace detector against fixture repositories.
 *
 * These tests exercise the real `NodeFilesystemReader` against the
 * `packages/test-fixtures/*` directories. They are fast (no process spawning)
 * but cover the full filesystem-inspection path.
 */

import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { detectWorkspaceProfile } from "../src/detector/ProjectDetector.js";

const FIXTURES = path.resolve(__dirname, "../../test-fixtures");

describe("detectWorkspaceProfile", () => {
  it("detects the ESLint + Prettier + Jest + Prisma + Docker fixture", async () => {
    const profile = await detectWorkspaceProfile(path.join(FIXTURES, "node-ts-eslint"));

    expect(profile.runtime).toBe("node");
    expect(profile.packageManager).toBe("npm"); // package-lock.json absent, but engines.node present
    expect(profile.typescript).toBe(true);
    expect(profile.linter).toBe("eslint");
    expect(profile.formatter).toBe("prettier");
    expect(profile.testRunner).toBe("jest");
    expect(profile.orm).toBe("prisma");
    expect(profile.docker).toBe(true);
    expect(profile.githubActions).toBe(true);
    expect(profile.monorepo).toBe("none");
  });

  it("detects the Biome + Vitest + Drizzle fixture", async () => {
    const profile = await detectWorkspaceProfile(path.join(FIXTURES, "node-ts-biome"));

    expect(profile.runtime).toBe("node");
    expect(profile.typescript).toBe(true);
    expect(profile.linter).toBe("biome");
    expect(profile.formatter).toBe("biome");
    expect(profile.testRunner).toBe("vitest");
    expect(profile.orm).toBe("drizzle");
    expect(profile.docker).toBe(false);
  });

  it("detects pnpm workspaces (Turborepo present but pnpm takes precedence)", async () => {
    const profile = await detectWorkspaceProfile(path.join(FIXTURES, "pnpm-monorepo"));

    expect(profile.packageManager).toBe("pnpm");
    // pnpm-workspace.yaml is the source of truth for monorepo structure;
    // turbo.json is a build tool layered on top, so monorepo kind stays "pnpm".
    expect(profile.monorepo).toBe("pnpm");
    // Workspace packages should include apps/api, apps/web, packages/shared
    expect(profile.workspacePackages.length).toBeGreaterThanOrEqual(3);
    const names = profile.workspacePackages.map((p) => path.basename(p)).sort();
    expect(names).toEqual(expect.arrayContaining(["api", "web", "shared"]));
    // Turbo.json should still be recorded as evidence in signals.
    expect(profile.signals.files["turbo.json"]).toBe(true);
  });

  it("survives a minimal broken-project fixture", async () => {
    const profile = await detectWorkspaceProfile(
      path.join(FIXTURES, "pnpm-monorepo", "broken-project")
    );

    expect(profile.runtime).toBe("node"); // package.json present, no engines
    expect(profile.typescript).toBe(false);
    expect(profile.linter).toBeUndefined();
    expect(profile.formatter).toBeUndefined();
    expect(profile.testRunner).toBe("unknown");
    expect(profile.docker).toBe(false);
    expect(profile.monorepo).toBe("none");
  });

  it("populates signals with the evidence it collected", async () => {
    const profile = await detectWorkspaceProfile(path.join(FIXTURES, "node-ts-eslint"));

    expect(profile.signals.files["package.json"]).toBe(true);
    expect(profile.signals.files["tsconfig.json"]).toBe(true);
    expect(profile.signals.files["eslint.config.mjs"]).toBe(true);
    expect(profile.signals.files[".prettierrc.json"]).toBe(true);
    expect(profile.signals.files["prisma/schema.prisma"]).toBe(true);
    expect(profile.signals.files["Dockerfile"]).toBe(true);
    expect(profile.signals.files[".github/workflows/"]).toBe(true);
    expect(profile.signals.configFiles["eslint"]).toBeTruthy();
    expect(profile.signals.configFiles["prettier"]).toBeTruthy();
    expect(profile.signals.configFiles["prisma"]).toBeTruthy();
  });

  it("returns unknown runtime / package manager when no package.json exists", async () => {
    // Use a temp path that doesn't exist — fs reader should return undefined.
    const profile = await detectWorkspaceProfile(path.join(FIXTURES, "does-not-exist-xyz"));

    expect(profile.runtime).toBe("unknown");
    expect(profile.packageManager).toBe("unknown");
    expect(profile.typescript).toBe(false);
    expect(profile.docker).toBe(false);
  });
});
