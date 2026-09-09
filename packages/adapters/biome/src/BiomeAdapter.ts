/**
 * Biome adapter.
 *
 * Runs the project's own Biome via `biome ci --reporter=json` and parses the
 * structured JSON output into normalized `Diagnostic[]`. We do NOT reimplement
 * Biome — we discover the project's local installation and wrap its CLI.
 *
 * Output shape (single JSON object on stdout, may be prefixed with ANSI codes):
 *
 *   {
 *     "summary": { "errors": N, "warnings": N, ... },
 *     "diagnostics": [
 *       {
 *         "category": "lint/suspicious/noExplicitAny" | "format" | ...,
 *         "severity": "error" | "warning",
 *         "description": "main message",
 *         "location": {
 *           "path": { "file": "./src/foo.ts" },
 *           "span": [startByte, endByte] | null,
 *           "sourceCode": "full file content"
 *         },
 *         "tags": ["fixable"] | []
 *       }
 *     ],
 *     "command": "ci"
 *   }
 *
 * Category format: `<group>/<sub>/<rule>` (e.g. `lint/suspicious/noExplicitAny`).
 * The rule name is the last segment after the final `/`. Categories without
 * a rule (like `format`) use the category itself as the rule.
 *
 * Span offsets are byte offsets into `sourceCode`. We convert them to
 * 1-based line/column by counting newlines in the source.
 */

import * as path from "node:path";
import {
  AdapterParseError,
  FileNotFoundError,
  type Diagnostic,
  type DiagnosticSeverity,
  type CommandRequest
} from "@nodeforge/contracts";
import { ProcessRunner, resolveExecutable } from "@nodeforge/runner";

export interface BiomeAdapterOptions {
  /** Override the path to the Biome binary. If unset, adapter resolves from the workspace. */
  biomePath?: string;
  /** Glob patterns to check. Defaults to ["."]. */
  patterns?: string[];
  /** Hard timeout for the biome run, in ms. Defaults to 60_000. */
  timeoutMs?: number;
  /** Extra args to pass to biome (e.g. ["--no-errors-on-unmatched"]). */
  extraArgs?: string[];
}

export interface BiomeRunResult {
  diagnostics: Diagnostic[];
  /** Raw biome stdout (the JSON payload, after ANSI stripping). */
  rawStdout: string;
  rawStderr: string;
  durationMs: number;
  exitCode: number | null;
  /** Summary counts from biome. */
  summary: BiomeSummary | undefined;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export interface BiomeSummary {
  errors: number;
  warnings: number;
  changed: number;
  unchanged: number;
  skipped: number;
}

export class BiomeAdapter {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly options: BiomeAdapterOptions = {}
  ) {}

  /**
   * Run `biome ci --reporter=json` for the given workspace root.
   *
   * Resolution order for the Biome binary:
   *   1. `<root>/node_modules/.bin/biome`
   *   2. `<root>/node_modules/@biomejs/biome/bin/biome`
   *   3. PATH lookup via `resolveExecutable("biome")`
   *
   * Biome exits 0 on success, 1 on errors/warnings (when `ci` finds issues),
   * 2 on config/system errors. We treat exit 1 as "diagnostics present".
   */
  async run(workspaceRoot: string, signal?: AbortSignal): Promise<BiomeRunResult> {
    const biomeBin = this.options.biomePath ?? (await resolveBiomeBinary(workspaceRoot));
    if (!biomeBin) {
      throw new FileNotFoundError("biome");
    }

    const patterns = this.options.patterns ?? ["."];
    const args = ["ci", "--reporter=json", ...patterns];
    if (this.options.extraArgs) {
      args.push(...this.options.extraArgs);
    }

    const request: CommandRequest = {
      command: biomeBin,
      args,
      cwd: workspaceRoot,
      timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal
    };

    const result = await this.runner.run(request);

    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    const exitCode = result.exitCode ?? null;

    // Exit 2 means config or system error — surface as parse failure.
    if (exitCode === 2) {
      throw new AdapterParseError("biome", `Biome exited with code 2 (config error): ${stderr || stdout}`);
    }

    const { diagnostics, summary } = parseBiomeJsonOutput(stdout, workspaceRoot);

    return {
      diagnostics,
      rawStdout: stdout,
      rawStderr: stderr,
      durationMs: result.durationMs,
      exitCode,
      summary
    };
  }

  /**
   * Run `biome format --write` to auto-format files. Returns a summary of
   * how many files were formatted.
   *
   * This is a write operation — it modifies files on disk. The caller is
   * responsible for ensuring Workspace Trust is granted.
   */
  async format(workspaceRoot: string, signal?: AbortSignal): Promise<{
    filesFormatted: number;
    rawStdout: string;
    rawStderr: string;
    exitCode: number | null;
    durationMs: number;
  }> {
    const biomeBin = this.options.biomePath ?? (await resolveBiomeBinary(workspaceRoot));
    if (!biomeBin) {
      throw new FileNotFoundError("biome");
    }

    const patterns = this.options.patterns ?? ["."];
    const args = ["format", "--write", ...patterns];

    const request: CommandRequest = {
      command: biomeBin,
      args,
      cwd: workspaceRoot,
      timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal
    };

    const result = await this.runner.run(request);
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";

    // Biome's --write output includes a summary line like:
    //   "Formatted N files in Xms."
    // We extract the count.
    const match = /Formatted\s+(\d+)\s+files?/i.exec(stdout);
    const filesFormatted = match ? parseInt(match[1]!, 10) : 0;

    return {
      filesFormatted,
      rawStdout: stdout,
      rawStderr: stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs
    };
  }

  /**
   * Returns true if a biome.json config file exists in `workspaceRoot`.
   */
  static async hasConfig(workspaceRoot: string): Promise<boolean> {
    const fs = await import("node:fs/promises");
    for (const candidate of ["biome.json", "biome.jsonc"]) {
      try {
        await fs.access(path.join(workspaceRoot, candidate));
        return true;
      } catch {
        // continue
      }
    }
    return false;
  }
}

async function resolveBiomeBinary(workspaceRoot: string): Promise<string | undefined> {
  const localBin = path.join(workspaceRoot, "node_modules", ".bin", "biome");
  try {
    const fs = await import("node:fs/promises");
    await fs.access(localBin);
    return localBin;
  } catch {
    // next
  }

  const directPath = path.join(workspaceRoot, "node_modules", "@biomejs", "biome", "bin", "biome");
  try {
    const fs = await import("node:fs/promises");
    await fs.access(directPath);
    return directPath;
  } catch {
    // fall through to PATH
  }

  return resolveExecutable("biome");
}

// JSON shape produced by `biome ci --reporter=json`.
interface BiomeJsonResult {
  summary?: {
    changed?: number;
    unchanged?: number;
    errors?: number;
    warnings?: number;
    skipped?: number;
    suggestedFixesSkipped?: number;
    diagnosticsNotPrinted?: number;
    duration?: { secs?: number; nanos?: number };
  };
  diagnostics?: BiomeDiagnostic[];
  command?: string;
}

interface BiomeDiagnostic {
  category: string;
  severity: "error" | "warning" | "info";
  description: string;
  message?: Array<{ content: string }>;
  location?: {
    path?: { file?: string };
    span?: [number, number] | null;
    sourceCode?: string;
  };
  tags?: string[];
}

/**
 * Strip ANSI escape sequences from a string. Biome (and other CLIs) sometimes
 * emit color codes even in JSON mode.
 */
export function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Parse `biome ci --reporter=json` stdout into normalized diagnostics.
 *
 * The input may have leading/trailing whitespace or ANSI codes — both are
 * stripped before JSON.parse().
 */
export function parseBiomeJsonOutput(
  stdout: string,
  workspaceRoot: string
): { diagnostics: Diagnostic[]; summary: BiomeSummary | undefined } {
  const cleaned = stripAnsi(stdout).trim();
  if (!cleaned) {
    return { diagnostics: [], summary: undefined };
  }

  let parsed: BiomeJsonResult;
  try {
    parsed = JSON.parse(cleaned) as BiomeJsonResult;
  } catch (err) {
    throw new AdapterParseError("biome", `Failed to parse JSON output: ${(err as Error).message}`);
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.diagnostics)) {
    throw new AdapterParseError("biome", "Expected an object with a 'diagnostics' array");
  }

  const diagnostics: Diagnostic[] = [];
  for (const bio of parsed.diagnostics) {
    const relFile = bio.location?.path?.file;
    if (!relFile) {
      // Skip diagnostics without a file (rare — usually system errors).
      continue;
    }
    const absFile = path.resolve(workspaceRoot, relFile);
    const severity = mapSeverity(bio.severity);
    const rule = extractRuleName(bio.category);
    const span = bio.location?.span ?? null;
    const source = bio.location?.sourceCode ?? "";
    const { line, column } = spanToLineCol(span, source);
    const message = bio.description || (bio.message?.map((m) => m.content).join("") ?? "");

    diagnostics.push({
      id: `biome:${rule}:${absFile}:${line}:${column}`,
      source: "biome",
      severity,
      message,
      file: absFile,
      range: {
        line,
        column
      },
      rule,
      code: bio.category,
      fixable: Array.isArray(bio.tags) && bio.tags.includes("fixable")
    });
  }

  const summary: BiomeSummary | undefined = parsed.summary
    ? {
        errors: parsed.summary.errors ?? 0,
        warnings: parsed.summary.warnings ?? 0,
        changed: parsed.summary.changed ?? 0,
        unchanged: parsed.summary.unchanged ?? 0,
        skipped: parsed.summary.skipped ?? 0
      }
    : undefined;

  return { diagnostics, summary };
}

/**
 * Extract the rule name from a Biome category string.
 *
 * Examples:
 *   "lint/suspicious/noExplicitAny"  -> "noExplicitAny"
 *   "lint/style/useImportType"       -> "useImportType"
 *   "format"                         -> "format"
 *   "lint/a11y/useButtonType"       -> "useButtonType"
 */
export function extractRuleName(category: string): string {
  const segments = category.split("/");
  const last = segments[segments.length - 1];
  return last && last.length > 0 ? last : category;
}

function mapSeverity(s: string): DiagnosticSeverity {
  switch (s) {
    case "error":
      return "error";
    case "warning":
      return "warning";
    case "info":
      return "info";
    default:
      return "warning";
  }
}

/**
 * Convert a Biome byte-span `[start, end]` into a 1-based `{ line, column }`.
 *
 * Biome uses byte offsets into `sourceCode`. We compute the line by counting
 * `\n` characters before the offset, and the column by measuring the distance
 * from the last `\n` to the offset.
 *
 * Returns `{ line: 1, column: 1 }` when the span is null or the source is
 * empty — this is what Biome produces for whole-file diagnostics (e.g.
 * "format" findings) and matches LSP conventions for "no specific range".
 *
 * Note: we treat the source as UTF-8 for offset counting, matching Biome's
 * behavior. For ASCII-only sources (the common case in tests), this is
 * identical to char-offset counting.
 */
export function spanToLineCol(
  span: [number, number] | null | undefined,
  source: string
): { line: number; column: number } {
  if (!span || !Array.isArray(span) || span.length < 1) {
    return { line: 1, column: 1 };
  }
  const startByte = span[0];
  if (typeof startByte !== "number" || startByte < 0 || startByte > source.length) {
    return { line: 1, column: 1 };
  }

  // Count newlines before startByte to get line number (1-based).
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < startByte; i++) {
    if (source.charCodeAt(i) === 0x0a) {
      line++;
      lastNewline = i;
    }
  }
  // Column is the byte distance from the last newline (or start of file) + 1.
  const column = startByte - lastNewline;
  return { line, column };
}
