/**
 * Normalized diagnostic contract.
 *
 * Every adapter (TypeScript, ESLint, Biome, Prettier, tests, runtime, security)
 * MUST convert its tool-specific output into this shape before publishing.
 */

export type DiagnosticSource =
  | "typescript"
  | "eslint"
  | "biome"
  | "prettier"
  | "test"
  | "runtime"
  | "security";

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

/** 1-based line and column, matching LSP / VS Code conventions. */
export interface DiagnosticRange {
  /** 1-based line number. */
  line: number;
  /** 1-based column number (UTF-16 code units). */
  column: number;
  /** Optional end line. */
  endLine?: number;
  /** Optional end column. */
  endColumn?: number;
}

/**
 * A normalized diagnostic finding.
 *
 * `id` should be stable across runs for the same finding so the UI can
 * de-duplicate and the agent can reference it. A good default is
 * `${source}:${rule}:${file}:${line}:${column}`.
 */
export interface Diagnostic {
  id: string;
  source: DiagnosticSource;
  severity: DiagnosticSeverity;
  message: string;

  /** Absolute path to the affected file. */
  file: string;
  /** Range within the file. */
  range: DiagnosticRange;

  /** Tool-specific rule or code, e.g. `@typescript-eslint/no-explicit-any`. */
  rule?: string;
  /** Tool-specific numeric or string code, e.g. `2304`. */
  code?: string | number;

  /** Whether the tool reports this finding as auto-fixable. */
  fixable: boolean;

  /** Optional human-readable hint for the suggested fix. */
  suggestion?: string;

  /** Optional source of the related text (e.g. import chain). */
  related?: Array<{
    file: string;
    range?: DiagnosticRange;
    message: string;
  }>;

  /** Optional adapter-specific metadata. Use sparingly — prefer typed fields. */
  metadata?: Record<string, unknown>;
}

/**
 * A code action that the adapter can apply to fix one or more diagnostics.
 */
export interface DiagnosticFix {
  /** Title shown in the Quick Fix menu. */
  title: string;
  /** Diagnostics this fix addresses (by id). */
  diagnosticIds: string[];
  /** Kind of fix, used for grouping. */
  kind: "quickfix" | "refactor" | "source";
  /** Whether the fix is preferred over other fixes for the same diagnostic. */
  isPreferred?: boolean;
}

/**
 * Snapshot of all diagnostics at a point in time, grouped by source.
 */
export interface DiagnosticSnapshot {
  /** Monotonic timestamp (ms since epoch). */
  capturedAt: number;
  /** Total count by severity. */
  counts: Record<DiagnosticSeverity, number>;
  /** All findings, ungrouped. */
  diagnostics: Diagnostic[];
}
