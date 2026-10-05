/**
 * Pure builder for the "Explain with NodeForge" chat query. No `vscode` import.
 *
 * The query only carries bounded, fenced context (the diagnostic and the lines around it).
 * The participant's `explain` command then reads the real file through the source tools, so
 * the answer is grounded in the workspace rather than in this excerpt alone.
 */

/** A code fence long enough that the content cannot close it early (kept local: this file is loaded by node:test without a bundler). */
function fenced(text: string): string {
  const longestRun = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}\n${text}\n${fence}`;
}

export const MAX_EXPLAIN_MESSAGE_CHARS = 500;
export const MAX_EXPLAIN_SNIPPET_CHARS = 2000;
const CONTEXT_LINES = 6;

export interface ExplainTarget {
  /** Workspace-relative path with forward slashes. */
  readonly file: string;
  /** 1-based. */
  readonly line: number;
  readonly column?: number;
  readonly source?: string;
  readonly rule?: string;
  readonly severity?: string;
  readonly message?: string;
  /** Selected or surrounding text. */
  readonly snippet?: string;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Collapses to one line so diagnostic text cannot start a new markdown/prompt block. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function buildExplainQuery(target: ExplainTarget): string {
  const where = `${target.file}:${target.line}${target.column ? `:${target.column}` : ""}`;
  const lines = [`@nodeforge /explain ${where}`];
  const label = [target.severity, target.source, target.rule].filter((x): x is string => Boolean(x)).join(" · ");
  if (label) lines.push(`Finding: ${oneLine(label)}`);
  if (target.message) lines.push(`Message: ${clip(oneLine(target.message), MAX_EXPLAIN_MESSAGE_CHARS)}`);
  if (target.snippet?.trim()) {
    lines.push("Code:", fenced(clip(target.snippet, MAX_EXPLAIN_SNIPPET_CHARS)));
  }
  return lines.join("\n");
}

/** Lines `[line - CONTEXT, line + CONTEXT]` (1-based, clamped) of `text`, for diagnostics without a selection. */
export function excerptAround(text: string, line: number, context = CONTEXT_LINES): string {
  const all = text.split(/\r?\n/);
  const start = Math.max(1, line - context);
  const end = Math.min(all.length, line + context);
  return all.slice(start - 1, end).join("\n");
}

export interface ExplainArgs {
  readonly file: string;
  readonly line: number;
  readonly column?: number;
  readonly source?: string;
  readonly rule?: string;
  readonly severity?: string;
  readonly message?: string;
}

const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined;

/**
 * Validates the argument of `nodeforge.explainDiagnostic`. It can arrive from a hover command link,
 * so nothing is trusted: wrong types or a non-positive line yield undefined.
 */
export function parseExplainArgs(value: unknown): ExplainArgs | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const file = str(v["file"], 4096);
  const line = v["line"];
  if (!file || typeof line !== "number" || !Number.isInteger(line) || line < 1) return undefined;
  const column = typeof v["column"] === "number" && Number.isInteger(v["column"]) && v["column"] >= 1 ? v["column"] : undefined;
  return {
    file,
    line,
    ...(column !== undefined ? { column } : {}),
    ...(str(v["source"], 64) ? { source: str(v["source"], 64) as string } : {}),
    ...(str(v["rule"], 200) ? { rule: str(v["rule"], 200) as string } : {}),
    ...(str(v["severity"], 32) ? { severity: str(v["severity"], 32) as string } : {}),
    ...(str(v["message"], MAX_EXPLAIN_MESSAGE_CHARS) ? { message: str(v["message"], MAX_EXPLAIN_MESSAGE_CHARS) as string } : {})
  };
}

/** Markdown command link for hovers. Arguments are JSON-encoded into the URI. */
export function explainCommandLink(commandId: string, args: ExplainArgs, label: string): string {
  // encodeURIComponent leaves ( ) ! * ' alone; parentheses would end the markdown link early.
  const encoded = encodeURIComponent(JSON.stringify([args])).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `[${label}](command:${commandId}?${encoded})`;
}
