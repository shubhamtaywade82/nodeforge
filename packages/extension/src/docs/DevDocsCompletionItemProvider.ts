import * as vscode from "vscode";
import type { DevDocsOfflineManager } from "./DevDocsOfflineManager.js";
import type { DevDocsSearchHit } from "@nodeforge/contracts";

export class DevDocsCompletionItemProvider implements vscode.CompletionItemProvider {
  constructor(private readonly offlineManager: DevDocsOfflineManager) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.CompletionItem[] | undefined> {
    const range = document.getWordRangeAtPosition(position, /[A-Za-z_$][A-Za-z0-9_$]*/);
    if (!range) return undefined;

    const word = document.getText(range);
    // Avoid noisy suggestions on short inputs
    if (word.length < 3) return undefined;

    const hits = await this.offlineManager.search(word);
    if (token.isCancellationRequested || hits.length === 0) return undefined;

    return hits.slice(0, 5).map((hit) => this.toCompletionItem(hit, range));
  }

  private toCompletionItem(hit: DevDocsSearchHit, range: vscode.Range): vscode.CompletionItem {
    const item = new vscode.CompletionItem(hit.title, vscode.CompletionItemKind.Reference);
    item.detail = `(DevDocs) ${hit.slug}`;
    item.range = range;

    const md = new vscode.MarkdownString();
    md.isTrusted = false;
    md.appendMarkdown(`**${hit.title}** *(${hit.slug})*\n\n`);
    if (hit.snippet) {
      md.appendMarkdown(`${hit.snippet}\n\n`);
    }
    const onlineUrl = `https://devdocs.io/${encodeURIComponent(hit.slug)}/${encodeURIComponent(hit.pageKey)}`;
    md.appendMarkdown(`[View on DevDocs](${onlineUrl})`);

    item.documentation = md;
    return item;
  }
}
