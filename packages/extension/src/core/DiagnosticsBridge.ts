/**
 * DiagnosticsBridge — bridges NodeForge's `DiagnosticStore` to VS Code's
 * native Problems panel via `vscode.languages.createDiagnosticCollection`.
 *
 * Subscribes to `diagnostics.snapshot` and `diagnostics.cleared` events on
 * the bus and converts NodeForge `Diagnostic[]` into `vscode.Diagnostic[]`
 * grouped by file URI. This unlocks:
 *   - Editor squigglies (red/yellow/blue underlines)
 *   - Problems panel entries
 *   - Status bar error/warning count
 *   - F8 / Shift+F8 navigation
 *   - Quick Fix lightbulb integration (when paired with CodeActionProvider)
 */

import * as vscode from "vscode";
import type { EventBus, Diagnostic as NFDiagnostic, DiagnosticSeverity } from "@nodeforge/contracts";

export class DiagnosticsBridge {
  private readonly collection: vscode.DiagnosticCollection;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(bus: EventBus) {
    this.collection = vscode.languages.createDiagnosticCollection("nodeforge");

    // When any adapter publishes new diagnostics, refresh the Problems panel.
    const unsubSnapshot = bus.subscribe("diagnostics.snapshot", (e) => {
      this.syncFromSnapshot(e.snapshot.diagnostics);
    });

    // When a source is cleared, resync (the cleared source's entries should
    // disappear from the Problems panel).
    const unsubCleared = bus.subscribe("diagnostics.cleared", () => {
      // We don't know which files were affected by the clear, so we re-sync
      // from the store. But we don't have the store here — we rely on the
      // snapshot event that follows the clear event.
      // Actually, DiagnosticStore publishes both `cleared` and `snapshot`
      // events on clear, so the snapshot handler above will handle it.
    });

    this.disposables.push(
      { dispose: () => unsubSnapshot() },
      { dispose: () => unsubCleared() },
      this.collection
    );
  }

  /**
   * Sync the Problems panel from a flat list of NodeForge diagnostics.
   *
   * Groups diagnostics by file URI, converts severity levels, and calls
   * `collection.set(uri, diagnostics)` for each file.
   */
  private syncFromSnapshot(diagnostics: NFDiagnostic[]): void {
    // Group by file path.
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const d of diagnostics) {
      let arr = byFile.get(d.file);
      if (!arr) {
        arr = [];
        byFile.set(d.file, arr);
      }
      arr.push(this.toVscodeDiagnostic(d));
    }

    // Clear the collection first, then set each file's diagnostics.
    // This ensures files that previously had diagnostics but no longer do
    // get their entries removed from the Problems panel.
    this.collection.clear();
    for (const [filePath, diags] of byFile) {
      const uri = vscode.Uri.file(filePath);
      this.collection.set(uri, diags);
    }
  }

  /** Convert a NodeForge Diagnostic to a VS Code Diagnostic. */
  private toVscodeDiagnostic(d: NFDiagnostic): vscode.Diagnostic {
    const range = new vscode.Range(
      new vscode.Position(Math.max(0, d.range.line - 1), Math.max(0, d.range.column - 1)),
      new vscode.Position(
        Math.max(0, (d.range.endLine ?? d.range.line) - 1),
        Math.max(0, (d.range.endColumn ?? d.range.column + 1) - 1)
      )
    );

    const severity = this.mapSeverity(d.severity);
    const message = d.rule ? `${d.message} [${d.rule}]` : d.message;

    const diagnostic = new vscode.Diagnostic(range, message, severity);
    diagnostic.source = d.source;
    if (d.code !== undefined) {
      diagnostic.code = d.code;
    }
    // Mark fixable diagnostics so CodeActionProvider can offer Quick Fixes.
    if (d.fixable) {
      diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];
    }

    return diagnostic;
  }

  private mapSeverity(s: DiagnosticSeverity): vscode.DiagnosticSeverity {
    switch (s) {
      case "error":
        return vscode.DiagnosticSeverity.Error;
      case "warning":
        return vscode.DiagnosticSeverity.Warning;
      case "info":
        return vscode.DiagnosticSeverity.Information;
      case "hint":
        return vscode.DiagnosticSeverity.Hint;
    }
  }

  /** Clear all NodeForge diagnostics from the Problems panel. */
  clear(): void {
    this.collection.clear();
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
