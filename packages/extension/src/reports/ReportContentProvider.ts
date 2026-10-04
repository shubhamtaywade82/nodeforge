/** Serves read-only `nodeforge:` virtual documents (profile, diagnostics, graph, ...). */

import * as vscode from "vscode";
import { executeTool } from "@nodeforge/agent";
import type { Diagnostic, GitDiff } from "@nodeforge/contracts";
import type { ExtensionWorkspaceSession } from "../core/ExtensionWorkspaceSession.js";
import { logger } from "../core/Logger.js";
import {
  REPORTS,
  REPORT_SCHEME,
  parseReportPath,
  renderDiagnosticsMarkdown,
  renderGitDiff,
  renderJson,
  reportPath,
  type ReportDescriptor
} from "./reports.js";

export class ReportContentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;

  constructor(
    private readonly session: ExtensionWorkspaceSession,
    private readonly isTrusted: () => boolean
  ) {}

  async provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): Promise<string> {
    const descriptor = parseReportPath(uri.path);
    if (!descriptor) return `# Unknown NodeForge report: ${uri.path}\n`;
    // Fail closed before any tooling runs; the policy layer re-checks per tool.
    if (descriptor.requiresTrust && !this.isTrusted()) {
      return "# Restricted Mode\n\nTrust this workspace to generate this report.\n";
    }
    const nodeforge = this.session.getContext();
    if (!nodeforge) return "# No NodeForge workspace\n\nOpen a workspace folder first.\n";

    try {
      const root = nodeforge.getRoot();
      const trusted = this.isTrusted();
      // Every report is produced through the same policy-checked entry point as the language-model tools.
      const run = async (toolName: string, args: Record<string, unknown> = {}): Promise<string> =>
        executeTool(toolName, args, nodeforge, {
          caller: "vscode",
          workspaceTrusted: trusted,
          executionAllowed: trusted,
          writesAllowed: false,
          networkAllowed: trusted,
          approvalGranted: false
        });
      const json = async (toolName: string, args?: Record<string, unknown>): Promise<unknown> => {
        const text = await run(toolName, args);
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return text;
        }
      };

      let text: string;
      switch (descriptor.kind) {
        case "profile":
          text = renderJson(await json("getProjectContext"));
          break;
        case "diagnostics": {
          const diagnostics = await json("getDiagnostics");
          text = renderDiagnosticsMarkdown(Array.isArray(diagnostics) ? (diagnostics as Diagnostic[]) : [], root);
          break;
        }
        case "dependency-graph":
          text = renderJson(this.session.getGraphAnalysis() ?? (await json("getDependencyGraph")));
          break;
        case "dependencies":
          text = renderJson(this.session.getDependencyReport() ?? (await json("getDependencyReport")));
          break;
        case "database":
          text = renderJson(await json("getDatabaseSchema"));
          break;
        case "tests":
          text = renderJson(await json("getTestResults"));
          break;
        case "git-diff":
          text = renderGitDiff((await json("getGitDiff", { scope: "working" })) as GitDiff | undefined);
          break;
        default: {
          const unreachable: never = descriptor.kind;
          throw new Error(`Unhandled report kind: ${String(unreachable)}`);
        }
      }
      return token.isCancellationRequested ? "" : text;
    } catch (err) {
      logger.error(`Report ${descriptor.kind} failed`, err);
      return `# Report failed\n\n${err instanceof Error ? err.message : String(err)}\n`;
    }
  }

  /** Re-generate an already-open report. */
  refresh(uri: vscode.Uri): void {
    this.changed.fire(uri);
  }

  dispose(): void {
    this.changed.dispose();
  }
}

export function reportUri(descriptor: ReportDescriptor): vscode.Uri {
  return vscode.Uri.from({ scheme: REPORT_SCHEME, path: reportPath(descriptor) });
}

export function registerReports(
  context: vscode.ExtensionContext,
  session: ExtensionWorkspaceSession,
  isTrusted: () => boolean
): void {
  const provider = new ReportContentProvider(session, isTrusted);
  context.subscriptions.push(
    provider,
    vscode.workspace.registerTextDocumentContentProvider(REPORT_SCHEME, provider),
    vscode.commands.registerCommand("nodeforge.openReport", async (kind?: string) => {
      let descriptor = REPORTS.find((r) => r.kind === kind);
      if (!descriptor) {
        const pick = await vscode.window.showQuickPick(
          REPORTS.map((r) => ({ label: r.title, description: r.requiresTrust ? "" : "read-only", descriptor: r })),
          { placeHolder: "Open a NodeForge report" }
        );
        descriptor = pick?.descriptor;
      }
      if (!descriptor) return;

      const uri = reportUri(descriptor);
      provider.refresh(uri);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.languages.setTextDocumentLanguage(doc, descriptor.language);
      await vscode.window.showTextDocument(doc, { preview: true });
    })
  );
}
