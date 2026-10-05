/**
 * NodeForgeHoverProvider — shows rule documentation, advisory URLs, and
 * vulnerability info when hovering over code with NodeForge diagnostics.
 *
 * When the cursor is over a line with a NodeForge diagnostic:
 *   - Shows the full diagnostic message with rule name
 *   - Shows a clickable link to the advisory URL (if available)
 *   - Shows the severity and source
 *
 * When hovering over a dependency in package.json:
 *   - Shows vulnerability count and severity if known
 *   - Shows the installed version and latest version
 */

import * as vscode from "vscode";
import type { DiagnosticStore } from "@nodeforge/core";
import { EXPLAIN_DIAGNOSTIC_COMMAND } from "../ai/explainCommands.js";
import { explainCommandLink } from "../ai/explainPrompt.js";

export class NodeForgeHoverProvider implements vscode.HoverProvider {
  constructor(private readonly store: DiagnosticStore) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    // Get NodeForge diagnostics at the cursor position.
    const allDiagnostics = vscode.languages.getDiagnostics(document.uri);
    const nodeforgeDiags = allDiagnostics.filter(
      (d) =>
        d.source === "typescript" ||
        d.source === "eslint" ||
        d.source === "biome" ||
        d.source === "runtime"
    );

    const overlapping = nodeforgeDiags.filter((d) =>
      d.range.contains(position)
    );

    if (overlapping.length === 0) return undefined;

    // Build markdown content for the hover.
    const markdownParts: vscode.MarkdownString[] = [];

    for (const diag of overlapping) {
      const sourceIcon = this.getSourceIcon(diag.source);
      const severityText = vscode.DiagnosticSeverity[diag.severity].toLowerCase();
      const md = new vscode.MarkdownString();
      // Only the Explain command may run from links in this hover.
      md.isTrusted = { enabledCommands: [EXPLAIN_DIAGNOSTIC_COMMAND] };
      md.supportThemeIcons = true;

      md.appendMarkdown(`**${sourceIcon} ${diag.source}** — \`${severityText}\`\n\n`);
      md.appendMarkdown(`${diag.message}\n\n`);

      if (diag.code) {
        const code = String(diag.code);
        if (diag.source === "eslint") {
          md.appendMarkdown(`[Rule documentation](https://eslint.org/docs/latest/rules/${code})\n\n`);
        } else if (diag.source === "typescript") {
          md.appendMarkdown(`[TS${code} documentation](https://aka.ms/typescript#${code})\n\n`);
        } else if (diag.source === "biome") {
          md.appendMarkdown(`[Biome rule: ${code}](https://biomejs.dev/linter/rules/${code})\n\n`);
        }
      }

      const explainLink = explainCommandLink(
        EXPLAIN_DIAGNOSTIC_COMMAND,
        {
          file: document.uri.fsPath,
          line: diag.range.start.line + 1,
          column: diag.range.start.character + 1,
          ...(diag.source ? { source: diag.source } : {}),
          severity: severityText,
          message: diag.message,
          ...(diag.code !== undefined ? { rule: String(diag.code) } : {})
        },
        "$(sparkle) Explain with NodeForge"
      );
      md.appendMarkdown(`${explainLink} · *lightbulb for Quick Fixes*`);

      markdownParts.push(md);
    }

    const range = new vscode.Range(position, position);
    return new vscode.Hover(markdownParts, range);
  }

  private getSourceIcon(source: string | undefined): string {
    switch (source) {
      case "typescript":
        return "$(ts-logo)";
      case "eslint":
        return "$(warning)";
      case "biome":
        return "$(beaker)";
      case "runtime":
        return "$(terminal)";
      default:
        return "$(info)";
    }
  }
}
