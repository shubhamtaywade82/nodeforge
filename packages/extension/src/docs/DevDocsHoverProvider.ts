import * as vscode from "vscode";
import type { DevDocsOfflineManager } from "./DevDocsOfflineManager.js";
import type { DevDocsSearchHit } from "@nodeforge/contracts";
import { isSafeDocFile, isSafeDocSlug, offlineDocCommandLink, plainMarkdownText } from "./offlineDocLink.js";

export const OPEN_OFFLINE_DOC_COMMAND = "nodeforge.openOfflineDoc";

const SKIP_KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "import", "export",
  "from", "class", "interface", "type", "if", "else", "for", "while",
  "switch", "case", "break", "default", "new", "this", "super", "async",
  "await", "try", "catch", "finally", "throw", "typeof", "instanceof",
  "true", "false", "null", "undefined", "void"
]);

export class DevDocsHoverProvider implements vscode.HoverProvider {
  constructor(private readonly offlineManager: DevDocsOfflineManager) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    const range = document.getWordRangeAtPosition(position, /[A-Za-z_$][A-Za-z0-9_$]*/);
    if (!range) return null;

    const word = document.getText(range);
    if (word.length < 2 || SKIP_KEYWORDS.has(word)) return null;

    const hits = await this.offlineManager.search(word);
    if (token.isCancellationRequested || hits.length === 0) return null;

    const bestHit = this.pickBestHit(hits, word);
    if (!bestHit) return null;

    const md = this.formatMarkdown(bestHit);
    return new vscode.Hover(md, range);
  }

  private pickBestHit(hits: DevDocsSearchHit[], word: string): DevDocsSearchHit | undefined {
    const lower = word.toLowerCase();
    return (
      hits.find((h) => h.pageKey.toLowerCase() === lower) ??
      hits.find((h) => h.title.toLowerCase() === lower) ??
      hits[0]
    );
  }

  private formatMarkdown(hit: DevDocsSearchHit): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.supportThemeIcons = true;
    // Docset data is untrusted: only the offline-open command may run from this hover, and its arguments are re-validated.
    md.isTrusted = { enabledCommands: [OPEN_OFFLINE_DOC_COMMAND] };
    md.appendMarkdown(`### $(book) DevDocs: \`${plainMarkdownText(hit.title)}\` *(${plainMarkdownText(hit.slug, 60)})*\n\n`);
    if (hit.snippet) {
      md.appendMarkdown(`${plainMarkdownText(hit.snippet, 400)}\n\n`);
    }
    if (isSafeDocSlug(hit.slug) && isSafeDocFile(hit.htmlFile)) {
      md.appendMarkdown(
        `${offlineDocCommandLink(OPEN_OFFLINE_DOC_COMMAND, { slug: hit.slug, htmlFile: hit.htmlFile }, "$(book) Open beside editor")} · `
      );
    }
    const onlineUrl = `https://devdocs.io/${encodeURIComponent(hit.slug)}/${encodeURIComponent(hit.pageKey)}`;
    md.appendMarkdown(`[View on DevDocs](${onlineUrl}) · *offline copy*`);
    return md;
  }
}
