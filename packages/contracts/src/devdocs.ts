/** Entry from https://devdocs.io/docs.json */
export interface DevDocsCatalogEntry {
  name: string;
  slug: string;
  mtime: number;
  db_size: number;
  version?: string;
}

export interface DevDocsDocsetSyncMeta {
  slug: string;
  /** DevDocs catalog mtime when synced. */
  mtime: number;
  syncedAt: number;
  /** Absolute path to extracted docset directory. */
  root: string;
}

export interface DevDocsSearchHit {
  slug: string;
  pageKey: string;
  title: string;
  snippet: string;
  /** HTML file name relative to docset root, e.g. `child_process.html`. */
  htmlFile: string;
}

export interface DevDocsSyncFailure {
  slug: string;
  message: string;
}

export interface DevDocsSyncReport {
  synced: string[];
  skipped: string[];
  failed: DevDocsSyncFailure[];
}
