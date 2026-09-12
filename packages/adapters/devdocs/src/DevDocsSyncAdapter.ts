import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { DevDocsDocsetSyncMeta, DevDocsSearchHit, DevDocsSyncReport } from "@nodeforge/contracts";
import type { ProcessRunner } from "@nodeforge/runner";

import { fetchDevDocsCatalog, findCatalogEntry } from "./catalog.js";
import { searchDevDocsDb, type DevDocsDb } from "./searchDb.js";

const DOWNLOAD_BASE = "https://downloads.devdocs.io";

export interface DevDocsSyncOptions {
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export class DevDocsSyncAdapter {
  constructor(
    private readonly cacheRoot: string,
    private readonly runner: ProcessRunner
  ) {}

  async listSynced(): Promise<DevDocsDocsetSyncMeta[]> {
    const out: DevDocsDocsetSyncMeta[] = [];
    try {
      const entries = await fs.readdir(this.cacheRoot, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const meta = await this.readMeta(path.join(this.cacheRoot, ent.name));
        if (meta) out.push(meta);
      }
    } catch {
      return [];
    }
    return out;
  }

  async syncSlugs(slugs: string[], options: DevDocsSyncOptions = {}): Promise<DevDocsSyncReport> {
    await fs.mkdir(this.cacheRoot, { recursive: true });
    const catalog = await fetchDevDocsCatalog(options.signal);
    const report: DevDocsSyncReport = { synced: [], skipped: [], failed: [] };

    for (const slug of slugs) {
      options.onProgress?.(`Syncing ${slug}…`);
      try {
        const entry = findCatalogEntry(catalog, slug);
        if (!entry) {
          report.failed.push({ slug, message: "Slug not found in DevDocs catalog" });
          continue;
        }

        const dest = path.join(this.cacheRoot, slug);
        const existing = await this.readMeta(dest);
        if (existing && existing.mtime >= entry.mtime) {
          report.skipped.push(slug);
          continue;
        }

        await this.downloadAndExtract(slug, dest, entry.mtime, options.signal);
        report.synced.push(slug);
      } catch (err) {
        report.failed.push({
          slug,
          message: err instanceof Error ? err.message : String(err)
        });
      }
    }

    return report;
  }

  async searchOffline(slugs: string[], query: string, limit = 15): Promise<DevDocsSearchHit[]> {
    const all: DevDocsSearchHit[] = [];
    for (const slug of slugs) {
      const dbPath = path.join(this.cacheRoot, slug, "db.json");
      try {
        const raw = await fs.readFile(dbPath, "utf8");
        const db = JSON.parse(raw) as DevDocsDb;
        all.push(...searchDevDocsDb(slug, db, query, limit));
      } catch {
        // docset not synced
      }
    }
    return all.slice(0, limit);
  }

  resolveHtmlPath(slug: string, htmlFile: string): string {
    return path.join(this.cacheRoot, slug, htmlFile);
  }

  private async downloadAndExtract(
    slug: string,
    dest: string,
    mtime: number,
    signal?: AbortSignal
  ): Promise<void> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nodeforge-devdocs-"));
    const archive = path.join(tmpDir, `${slug}.tar.gz`);
    const url = `${DOWNLOAD_BASE}/${slug}.tar.gz`;

    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`Download failed (${response.status}) for ${slug}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(archive, buffer);

    await fs.rm(dest, { recursive: true, force: true });
    await fs.mkdir(dest, { recursive: true });

    const result = await this.runner.run({
      command: "tar",
      args: ["-xzf", archive, "-C", dest, "--strip-components=1"],
      cwd: tmpDir,
      signal
    });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `tar exited ${result.exitCode}`);
    }

    const meta: DevDocsDocsetSyncMeta = {
      slug,
      mtime,
      syncedAt: Date.now(),
      root: dest
    };
    await fs.writeFile(path.join(dest, "nodeforge-meta.json"), JSON.stringify(meta, null, 2), "utf8");
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  private async readMeta(dest: string): Promise<DevDocsDocsetSyncMeta | undefined> {
    try {
      const raw = await fs.readFile(path.join(dest, "nodeforge-meta.json"), "utf8");
      return JSON.parse(raw) as DevDocsDocsetSyncMeta;
    } catch {
      return undefined;
    }
  }
}
