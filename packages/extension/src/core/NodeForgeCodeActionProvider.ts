/**
 * Safe Quick Fix provider for NodeForge diagnostics.
 *
 * Fix actions are offered only when the normalized NodeForge diagnostic reports
 * that the finding is auto-fixable. TypeScript errors are never hidden with
 * blanket suppression comments.
 */

import * as vscode from "vscode";
import type { Diagnostic as NFDiagnostic } from "@nodeforge/contracts";
import type { DiagnosticStore } from "@nodeforge/core";
import { EXPLAIN_DIAGNOSTIC_COMMAND, type DiagnosticExplainArgs } from "../ai/explainCommands.js";

export class NodeForgeCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
    vscode.CodeActionKind.Source
  ];

  constructor(private readonly store: DiagnosticStore) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range
  ): vscode.CodeAction[] {
    const diagnostics = this.store.all().filter(
      (diagnostic) =>
        diagnostic.file === document.uri.fsPath &&
        overlaps(diagnostic, range)
    );

    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of diagnostics) {
      actions.push(...this.actionsForDiagnostic(document, diagnostic));
    }

    if (diagnostics.length > 0) {
      const format = new vscode.CodeAction(
        "Format with NodeForge",
        vscode.CodeActionKind.Source
      );
      format.command = {
        command: "nodeforge.formatCurrentFile",
        title: "Format with NodeForge"
      };
      actions.push(format);
    }

    return actions;
  }

  private actionsForDiagnostic(
    document: vscode.TextDocument,
    diagnostic: NFDiagnostic
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    const explainArgs: DiagnosticExplainArgs = {
      file: diagnostic.file,
      line: diagnostic.range.line,
      column: diagnostic.range.column,
      source: diagnostic.source,
      severity: diagnostic.severity,
      message: diagnostic.message,
      ...(diagnostic.rule ? { rule: diagnostic.rule } : {})
    };
    const explain = new vscode.CodeAction(
      `Explain with NodeForge: ${diagnostic.rule ?? diagnostic.source}`,
      vscode.CodeActionKind.QuickFix
    );
    explain.command = { command: EXPLAIN_DIAGNOSTIC_COMMAND, title: "Explain with NodeForge", arguments: [explainArgs] };
    actions.push(explain);

    if (diagnostic.fixable && diagnostic.source === "eslint") {
      const action = new vscode.CodeAction(
        "Apply ESLint auto-fixes",
        vscode.CodeActionKind.QuickFix
      );
      action.command = {
        command: "nodeforge.applyEslintFix",
        title: "Apply ESLint auto-fixes"
      };
      action.isPreferred = true;
      actions.push(action);
    }

    if (diagnostic.fixable && diagnostic.source === "biome") {
      const action = new vscode.CodeAction(
        "Apply Biome safe fixes",
        vscode.CodeActionKind.QuickFix
      );
      action.command = {
        command: "nodeforge.applyBiomeFix",
        title: "Apply Biome safe fixes"
      };
      actions.push(action);
    }

    if (
      (diagnostic.source === "eslint" || diagnostic.source === "biome") &&
      diagnostic.rule
    ) {
      const action = new vscode.CodeAction(
        `Disable ${diagnostic.source}/${diagnostic.rule} on this line`,
        vscode.CodeActionKind.QuickFix
      );
      action.edit = new vscode.WorkspaceEdit();

      const lineIndex = Math.max(0, diagnostic.range.line - 1);
      const line = document.lineAt(lineIndex);
      const comment =
        diagnostic.source === "eslint"
          ? "// eslint-disable-next-line " + diagnostic.rule
          : "// biome-ignore lint/" +
            diagnostic.rule +
            ": intentional exception";

      action.edit.insert(
        document.uri,
        new vscode.Position(line.range.start.line, 0),
        comment + "\n"
      );
      actions.push(action);
    }

    return actions;
  }
}

function overlaps(
  diagnostic: NFDiagnostic,
  range: vscode.Range
): boolean {
  const start = new vscode.Position(
    Math.max(0, diagnostic.range.line - 1),
    Math.max(0, diagnostic.range.column - 1)
  );
  const end = new vscode.Position(
    Math.max(0, (diagnostic.range.endLine ?? diagnostic.range.line) - 1),
    Math.max(
      0,
      (diagnostic.range.endColumn ?? diagnostic.range.column + 1) - 1
    )
  );

  return new vscode.Range(start, end).intersection(range) !== undefined;
}
