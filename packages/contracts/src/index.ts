/**
 * NodeForge contracts — the language spoken by every NodeForge package.
 *
 * Pure types and small pure helpers only. No runtime I/O, no `vscode`, no
 * `child_process`, no filesystem. Anything that touches the outside world
 * lives in `packages/core`, `packages/runner`, or `packages/adapters/*`.
 */

export * from "./errors.js";
export * from "./diagnostic.js";
export * from "./workspace.js";
export * from "./test.js";
export * from "./runtime.js";
export * from "./git.js";
export * from "./dependency.js";
export * from "./database.js";
export * from "./command.js";
export * from "./event.js";
export * from "./docker.js";
export * from "./kubernetes.js";
export * from "./github-actions.js";
export * from "./dependency-graph.js";
export * from "./chat.js";

/**
 * Build a stable diagnostic id from its parts. Used by every adapter so
 * de-duplication and references are consistent across the system.
 */
export function diagnosticId(parts: {
  source: string;
  rule?: string;
  file: string;
  line: number;
  column: number;
}): string {
  return [parts.source, parts.rule ?? "nocode", parts.file, parts.line, parts.column].join(":");
}

/** Empty diagnostic counts helper, used by snapshots. */
export function emptyDiagnosticCounts(): {
  error: number;
  warning: number;
  info: number;
  hint: number;
} {
  return { error: 0, warning: 0, info: 0, hint: 0 };
}
