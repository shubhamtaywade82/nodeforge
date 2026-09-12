import { describe, expect, it } from "vitest";

import type { WorkspaceProfile } from "@nodeforge/contracts";
import { buildDevDocsUrl, devDocsDefaultSlug, suggestDevDocsSlugs } from "../src/devdocs/suggestDevDocs.js";

function minimalProfile(overrides: Partial<WorkspaceProfile> = {}): WorkspaceProfile {
  return {
    root: "/tmp/proj",
    runtime: "node",
    packageManager: "npm",
    typescript: true,
    docker: false,
    kubernetes: false,
    githubActions: false,
    monorepo: "none",
    workspacePackages: [],
    signals: { files: {} },
    ...overrides
  };
}

describe("suggestDevDocsSlugs", () => {
  it("includes javascript, typescript, and node for a typical TS project", () => {
    const slugs = suggestDevDocsSlugs(minimalProfile({ linter: "eslint", testRunner: "vitest" }));
    expect(slugs).toContain("javascript");
    expect(slugs).toContain("typescript");
    expect(slugs).toContain("node");
    expect(slugs).toContain("npm");
    expect(slugs).toContain("eslint");
    expect(slugs).toContain("vitest");
  });
});

describe("buildDevDocsUrl", () => {
  it("builds search URLs", () => {
    expect(buildDevDocsUrl({ query: "Array.map" })).toBe("https://devdocs.io/#q=Array.map");
  });

  it("builds slug URLs", () => {
    expect(buildDevDocsUrl({ slug: "node" })).toBe("https://devdocs.io/node/");
  });

  it("picks default slug from profile", () => {
    expect(devDocsDefaultSlug(minimalProfile())).toBe("typescript");
  });
});
