import * as path from "node:path";
import * as vscode from "vscode";
import { logger } from "../core/Logger.js";
import { buildExplainQuery, excerptAround, parseExplainArgs, type ExplainTarget } from "./explainPrompt.js";

export const EXPLAIN_DIAGNOSTIC_COMMAND = "nodeforge.explainDiagnostic";

/** Argument shape shared by Quick Fixes and hover links. */
export interface DiagnosticExplainArgs {
  file: string;
  line: number;
  column?: number;
  source?: string;
  rule?: string;
  severity?: string;
  message?: string;
}

async function openChat(target: ExplainTarget): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.chat.open", {
    query: buildExplainQuery(target),
    isPartialQuery: false
  });
}

function relativeToWorkspace(absolute: string): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(absolute));
  if (!folder) return undefined;
  return path.relative(folder.uri.fsPath, absolute).split(path.sep).join("/");
}

export function registerExplainCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("nodeforge.explainDiagnostic", async (raw: unknown) => {
      const args = parseExplainArgs(raw);
      if (!args) {
        logger.warn("explainDiagnostic called with invalid arguments");
        return;
      }
      const relative = relativeToWorkspace(args.file);
      if (!relative) {
        void vscode.window.showWarningMessage("NodeForge: that file is not inside the workspace.");
        return;
      }
      let snippet: string | undefined;
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(args.file));
        snippet = excerptAround(doc.getText(), args.line);
      } catch (err) {
        logger.warn(`Could not read ${relative} for explanation: ${String(err)}`);
      }
      await openChat({ ...args, file: relative, ...(snippet !== undefined ? { snippet } : {}) });
    }),

    vscode.commands.registerCommand("nodeforge.explainSelection", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const relative = relativeToWorkspace(editor.document.uri.fsPath);
      if (!relative) {
        void vscode.window.showWarningMessage("NodeForge: open a file inside the workspace to explain it.");
        return;
      }
      const sel = editor.selection;
      const text = sel.isEmpty ? excerptAround(editor.document.getText(), sel.active.line + 1) : editor.document.getText(sel);
      await openChat({
        file: relative,
        line: sel.start.line + 1,
        column: sel.start.character + 1,
        snippet: text
      });
    })
  );
}
