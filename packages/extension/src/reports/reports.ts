/**
 * Pure model + renderers for the `nodeforge:` virtual report documents.
 * No `vscode` import.
 */

import type { Diagnostic, DiagnosticSeverity, GitDiff } from "@nodeforge/contracts";

export const REPORT_SCHEME = "nodeforge";

export type ReportKind =
  | "profile"
  | "diagnostics"
  | "dependency-graph"
  | "dependencies"
  | "database"
  | "tests"
  | "git-diff";

export interface ReportDescriptor {
  readonly kind: ReportKind;
  readonly title: string;
  readonly extension: "json" | "md" | "diff";
  readonly language: "json" | "markdown" | "diff";
  /** Needs Workspace Trust because producing it executes project tooling. */
  readonly requiresTrust: boolean;
}

export const REPORTS: readonly ReportDescriptor[] = [
  { kind: "profile", title: "Workspace profile", extension: "json", language: "json", requiresTrust: false },
  { kind: "diagnostics", title: "Diagnostics", extension: "md", language: "markdown", requiresTrust: true },
  { kind: "dependency-graph", title: "Dependency graph", extension: "json", language: "json", requiresTrust: true },
  { kind: "dependencies", title: "Dependency audit", extension: "json", language: "json", requiresTrust: true },
  { kind: "database", title: "Database schema", extension: "json", language: "json", requiresTrust: true },
  { kind: "tests", title: "Test results", extension: "json", language: "json", requiresTrust: true },
  { kind: "git-diff", title: "Git diff", extension: "diff", language: "diff", requiresTrust: true }
];

export function findReport(kind: string): ReportDescriptor | undefined {
  return REPORTS.find((r) => r.kind === kind);
}

/** `/diagnostics.md` for kind `diagnostics`. */
export function reportPath(descriptor: ReportDescriptor): string {
  return `/${descriptor.kind}.${descriptor.extension}`;
}

export function parseReportPath(path: string): ReportDescriptor | undefined {
  const match = /^\/([a-z-]+)\.(json|md|diff)$/.exec(path);
  if (!match?.[1]) return undefined;
  const descriptor = findReport(match[1]);
  return descriptor && descriptor.extension === match[2] ? descriptor : undefined;
}

const SEVERITY_ORDER: readonly DiagnosticSeverity[] = ["error", "warning", "info", "hint"];

function relativeTo(root: string, file: string): string {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}

export function renderDiagnosticsMarkdown(diagnostics: readonly Diagnostic[], root: string): string {
  const lines: string[] = ["# NodeForge diagnostics", ""];
  if (diagnostics.length === 0) {
    lines.push("No findings.");
    return lines.join("\n") + "\n";
  }

  const counts = SEVERITY_ORDER.map((sev) => [sev, diagnostics.filter((d) => d.severity === sev).length] as const)
    .filter(([, n]) => n > 0)
    .map(([sev, n]) => `${n} ${sev}${n === 1 ? "" : "s"}`);
  lines.push(`${diagnostics.length} findings: ${counts.join(", ")}`, "");

  const byFile = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    const list = byFile.get(d.file) ?? [];
    list.push(d);
    byFile.set(d.file, list);
  }

  for (const file of [...byFile.keys()].sort()) {
    lines.push(`## ${relativeTo(root, file)}`, "");
    const items = [...(byFile.get(file) ?? [])].sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
        a.range.line - b.range.line ||
        a.range.column - b.range.column
    );
    for (const d of items) {
      const rule = d.rule ?? (d.code !== undefined ? String(d.code) : "");
      lines.push(
        `- **${d.severity}** \`${d.source}${rule ? `/${rule}` : ""}\` ${d.range.line}:${d.range.column} — ${d.message.replace(/\s*\n\s*/g, " ")}${d.fixable ? " _(fixable)_" : ""}`
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function renderGitDiff(diff: GitDiff | undefined): string {
  if (!diff || (!diff.patch && diff.files.length === 0)) return "# No changes\n";
  return diff.patch.endsWith("\n") ? diff.patch : `${diff.patch}\n`;
}

export function renderJson(value: unknown): string {
  return `${JSON.stringify(value ?? null, null, 2)}\n`;
}
