import * as vscode from "vscode";
import type { DependencyGraphAnalysis, DependencyReport } from "@nodeforge/contracts";

const SOURCE = "nodeforge-dependencies";

export class DependencyDiagnosticPublisher {
  private readonly collection: vscode.DiagnosticCollection;
  private report: DependencyReport | undefined;
  private graph: DependencyGraphAnalysis | undefined;
  private graphRoot = "";

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection(SOURCE);
  }

  dispose(): void {
    this.collection.dispose();
  }

  publishReport(report: DependencyReport | undefined): void {
    this.report = report;
    this.flush();
  }

  publishGraph(analysis: DependencyGraphAnalysis | undefined, root: string): void {
    this.graph = analysis;
    this.graphRoot = root;
    this.flush();
  }

  clear(): void {
    this.report = undefined;
    this.graph = undefined;
    this.collection.clear();
  }

  private flush(): void {
    this.collection.clear();
    if (this.report) {
      this.collection.set(
        vscode.Uri.file(`${this.report.root}/package.json`),
        reportDiagnostics(this.report)
      );
    }
    if (this.graph && this.graphRoot) {
      for (const missing of this.graph.missing) {
        for (const file of missing.importedBy) {
          const uri = vscode.Uri.file(file.startsWith("/") ? file : `${this.graphRoot}/${file}`);
          const existing = this.collection.get(uri) ?? [];
          const message = `Missing dependency "${missing.packageName}" (imported but not in package.json)`;
          const diag = new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 1),
            message,
            vscode.DiagnosticSeverity.Warning
          );
          diag.source = SOURCE;
          this.collection.set(uri, [...existing, diag]);
        }
      }
    }
  }
}

function reportDiagnostics(report: DependencyReport): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  for (const finding of report.findings) {
    const severity = toSeverity(finding.severity);
    if (severity === vscode.DiagnosticSeverity.Hint) continue;

    const message = `${finding.packageName}: ${finding.title} (installed ${finding.installed}${
      finding.recommended ? `, fix: ${finding.recommended}` : ""
    })`;
    const diag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), message, severity);
    diag.source = SOURCE;
    diag.code = finding.advisory;
    diagnostics.push(diag);
  }
  return diagnostics;
}

function toSeverity(severity: string): vscode.DiagnosticSeverity {
  switch (severity) {
    case "critical":
    case "high":
      return vscode.DiagnosticSeverity.Error;
    case "moderate":
      return vscode.DiagnosticSeverity.Warning;
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}
