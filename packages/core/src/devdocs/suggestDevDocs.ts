import type { WorkspaceProfile } from "@nodeforge/contracts";

const DEVDOCS_BASE = "https://devdocs.io";

/** DevDocs.io docset slugs known to exist on devdocs.io (subset). */
export function suggestDevDocsSlugs(profile: WorkspaceProfile): string[] {
  const slugs = new Set<string>(["javascript"]);

  if (profile.typescript) {
    slugs.add("typescript");
  }

  switch (profile.runtime) {
    case "node":
      slugs.add("node");
      break;
    case "bun":
      slugs.add("bun");
      break;
    case "deno":
      slugs.add("deno");
      break;
    default:
      slugs.add("node");
      break;
  }

  switch (profile.packageManager) {
    case "npm":
      slugs.add("npm");
      break;
    case "pnpm":
      slugs.add("pnpm");
      break;
    case "yarn":
      slugs.add("yarn");
      break;
    default:
      break;
  }

  if (profile.linter === "eslint") slugs.add("eslint");
  if (profile.testRunner === "jest") slugs.add("jest");
  if (profile.testRunner === "vitest") slugs.add("vitest");
  if (profile.docker) slugs.add("docker");
  if (profile.githubActions) slugs.add("github_actions");

  return [...slugs];
}

export function devDocsDefaultSlug(profile: WorkspaceProfile): string {
  if (profile.typescript) return "typescript";
  if (profile.runtime === "node") return "node";
  return "javascript";
}

export function buildDevDocsUrl(options: { slug?: string; query?: string }): string {
  if (options.query && options.query.trim()) {
    return `${DEVDOCS_BASE}/#q=${encodeURIComponent(options.query.trim())}`;
  }
  if (options.slug) {
    const slug = options.slug.replace(/^\/+|\/+$/g, "");
    return `${DEVDOCS_BASE}/${slug}/`;
  }
  return `${DEVDOCS_BASE}/`;
}

export const DEVDOCS_HOME_URL = DEVDOCS_BASE;
