import * as path from "node:path";
import * as vscode from "vscode";
import type { WorkspaceProfile } from "@nodeforge/contracts";
import { suggestDevDocsSlugs } from "@nodeforge/core";
import { DevDocsSyncAdapter } from "@nodeforge/adapter-devdocs";
import { ProcessRunner } from "@nodeforge/runner";

export class DevDocsOfflineManager {
  private readonly adapter: DevDocsSyncAdapter;
  private readonly rootDir: string;

  constructor(private readonly context: vscode.ExtensionContext) {
    const root = path.join(context.globalStorageUri.fsPath, "devdocs");
    this.rootDir = root;
    this.adapter = new DevDocsSyncAdapter(root, new ProcessRunner());
  }

  slugsToSync(profile?: WorkspaceProfile): string[] {
    const extra = vscode.workspace.getConfiguration("nodeforge.docs.offline").get<string[]>("extraSlugs", []);
    const fromProfile = profile ? suggestDevDocsSlugs(profile) : [];
    return [...new Set([...fromProfile, ...extra])];
  }

  async sync(slugs: string[]): Promise<void> {
    if (slugs.length === 0) {
      void vscode.window.showInformationMessage("NodeForge: no DevDocs docsets selected to sync.");
      return;
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "NodeForge: syncing DevDocs docsets" },
      async (progress) => {
        const report = await this.adapter.syncSlugs(slugs, {
          onProgress: (msg) => progress.report({ message: msg })
        });
        const parts: string[] = [];
        if (report.synced.length > 0) parts.push(`${report.synced.length} synced`);
        if (report.skipped.length > 0) parts.push(`${report.skipped.length} up to date`);
        if (report.failed.length > 0) parts.push(`${report.failed.length} failed`);
        void vscode.window.showInformationMessage(`NodeForge DevDocs: ${parts.join(", ") || "done"}`);
      }
    );
  }

  async search(query: string): Promise<ReturnType<DevDocsSyncAdapter["searchOffline"]>> {
    const synced = await this.adapter.listSynced();
    const slugs = synced.map((s) => s.slug);
    return this.adapter.searchOffline(slugs, query);
  }

  /** Resolves a docset page and returns it only if it stays inside the offline cache. */
  safeHtmlPath(slug: string, htmlFile: string): string | undefined {
    const resolved = path.resolve(this.adapter.resolveHtmlPath(slug, htmlFile));
    const rel = path.relative(path.resolve(this.rootDir), resolved);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel) ? resolved : undefined;
  }

  htmlPath(slug: string, htmlFile: string): string {
    return this.adapter.resolveHtmlPath(slug, htmlFile);
  }
}
