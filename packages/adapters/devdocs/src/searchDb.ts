import type { DevDocsSearchHit } from "@nodeforge/contracts";

/** DevDocs `db.json` shape: page key → HTML body. */
export type DevDocsDb = Record<string, string>;

export function searchDevDocsDb(
  slug: string,
  db: DevDocsDb,
  query: string,
  limit = 20
): DevDocsSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const hits: Array<{ score: number; hit: DevDocsSearchHit }> = [];

  for (const [pageKey, html] of Object.entries(db)) {
    if (pageKey === "index") continue;
    const plain = stripHtml(html);
    const title = titleFromKey(pageKey);
    const haystack = `${title} ${pageKey} ${plain}`.toLowerCase();
    if (!haystack.includes(q)) continue;

    let score = 0;
    if (pageKey.toLowerCase().includes(q)) score += 10;
    if (title.toLowerCase().includes(q)) score += 8;
    if (plain.toLowerCase().includes(q)) score += 2;

    hits.push({
      score,
      hit: {
        slug,
        pageKey,
        title,
        snippet: snippetAround(plain, q),
        htmlFile: `${pageKey}.html`
      }
    });
  }

  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((h) => h.hit);
}

function titleFromKey(pageKey: string): string {
  return pageKey
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function snippetAround(text: string, q: string, radius = 60): string {
  const idx = text.toLowerCase().indexOf(q);
  if (idx < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + q.length + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}
