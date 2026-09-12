/**
 * NodeForgeCodeActionProvider — Quick Fix lightbulbs for NodeForge diagnostics.
 *
 * When the cursor is on a line with a NodeForge diagnostic, VS Code shows
 * a lightbulb. Clicking it offers Quick Fixes:
 *
 *   - "Apply ESLint --fix" (if the diagnostic is from ESLint and fixable)
 *   - "Apply Biome Safe Fixes" (if the diagnostic is from Biome and fixable)
 *   - "Disable rule on this line" (adds an inline disable comment)
 *   - "Show NodeForge Output" (opens the output channel for debugging)
 *
 * The provider reads diagnostics from VS Code's DiagnosticCollection (which
 * we populated via DiagnosticsBridge) and generates CodeActions for each.
 */

import * as vscode from "vscode";
import { logger } from "./Logger.js";

const NODEFORGE_COLLECTION = "nodeforge";

export class NodeForgeCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
    vscode.CodeActionKind.Source
  ];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    // Get NodeForge diagnostics that overlap the cursor range.
    const nodeforgeDiags = vscode.languages.getDiagnostics(document.uri).filter(
      (d) => d.source === "typescript" || d.source === "eslint" || d.source === "biome"
    );

    const overlappingDiags = nodeforgeDiags.filter((d) => d.range.intersection(range));

    if (overlappingDiags.length === 0) return actions;

    // Check if we have fixable ESLint diagnostics.
    const eslintDiags = overlappingDiags.filter((d) => d.source === "eslint");
    if (eslintDiags.length > 0) {
      const fixAction = new vscode.CodeAction(
        "Apply ESLint --fix",
        vscode.CodeActionKind.QuickFix
      );
      fixAction.command = {
        command: "nodeforge.applyEslintFix",
        title: "Apply ESLint --fix"
      };
      fixAction.isPreferred = true;
      actions.push(fixAction);
    }

    // Check if we have fixable Biome diagnostics.
    const biomeDiags = overlappingDiags.filter((d) => d.source === "biome");
    if (biomeDiags.length > 0) {
      const fixAction = new vscode.CodeAction(
        "Apply Biome Safe Fixes",
        vscode.CodeActionKind.QuickFix
      );
      fixAction.command = {
        command: "nodeforge.applyBiomeFix",
        title: "Apply Biome Safe Fixes"
      };
      actions.push(fixAction);
    }

    // "Disable rule on this line" — adds an inline disable comment.
    for (const diag of overlappingDiags) {
      if (diag.code) {
        const ruleCode = String(diag.code);
        const disableAction = new vscode.CodeAction(
          `Disable ${diag.source}/${ruleCode} on this line`,
          vscode.CodeActionKind.QuickFix
        );
        disableAction.edit = new vscode.WorkspaceEdit();
        const line = document.lineAt(diag.range.start.line);
        const disableComment = diag.source === "eslint"
          ? `// eslint-disable-next-line ${ruleCode}`
          : diag.source === "biome"
            ? `// biome-ignore lint/${ruleCode}: temporarily disabled`
            : `// @ts-ignore`;
        disableAction.edit.insert(
          document.uri,
          new vscode.Position(line.range.start.line, 0),
          disableComment + "\n"
        );
        actions.push(disableAction);
      }
    }

    // "Format file" action.
    const formatAction = new vscode.CodeAction(
      "Format with NodeForge",
      vscode.CodeActionKind.QuickFix
    );
    formatAction.command = {
      command: "nodeforge.formatCurrentFile",
      title: "Format with NodeForge"
    };
    actions.push(formatAction);

    return actions;
  }
}
