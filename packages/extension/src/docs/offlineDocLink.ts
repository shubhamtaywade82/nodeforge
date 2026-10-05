/** Pure helpers for opening an offline DevDocs page from a hover/completion command link. No `vscode` import. */

const SLUG = /^[a-z0-9][a-z0-9_.~-]{0,79}$/i;

export interface OfflineDocRef {
  readonly slug: string;
  readonly htmlFile: string;
}

export function isSafeDocSlug(value: unknown): value is string {
  return typeof value === "string" && SLUG.test(value) && !value.includes("..");
}

/** A relative `.html` path inside the docset: no absolute paths, backslashes, NULs or `..` segments. */
export function isSafeDocFile(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) return false;
  if (value.includes("\0") || value.includes("\\") || value.startsWith("/")) return false;
  if (!/\.html$/i.test(value)) return false;
  return value.split("/").every((seg) => seg !== ".." && seg !== "." && seg !== "");
}

/** Validates the argument of `nodeforge.openOfflineDoc`; the argument can come from a link, so nothing is trusted. */
export function parseOfflineDocArgs(value: unknown): OfflineDocRef | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  return isSafeDocSlug(v["slug"]) && isSafeDocFile(v["htmlFile"])
    ? { slug: v["slug"], htmlFile: v["htmlFile"] }
    : undefined;
}

export function offlineDocCommandLink(commandId: string, ref: OfflineDocRef, label: string): string {
  const encoded = encodeURIComponent(JSON.stringify([ref])).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `[${label}](command:${commandId}?${encoded})`;
}

/** Makes docset-supplied text safe to place inside inline code or plain markdown text. */
export function plainMarkdownText(value: string, max = 120): string {
  return value.replace(/[`\r\n[\]()<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
