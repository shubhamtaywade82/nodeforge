import type { DevDocsCatalogEntry } from "@nodeforge/contracts";

const CATALOG_URL = "https://devdocs.io/docs.json";

export async function fetchDevDocsCatalog(signal?: AbortSignal): Promise<DevDocsCatalogEntry[]> {
  const response = await fetch(CATALOG_URL, { signal });
  if (!response.ok) {
    throw new Error(`DevDocs catalog request failed (${response.status})`);
  }
  const json = (await response.json()) as DevDocsCatalogEntry[];
  return json;
}

export function findCatalogEntry(catalog: DevDocsCatalogEntry[], slug: string): DevDocsCatalogEntry | undefined {
  return catalog.find((e) => e.slug === slug);
}
