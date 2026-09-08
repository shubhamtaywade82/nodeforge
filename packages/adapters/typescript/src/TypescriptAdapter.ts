/**
 * TypeScript adapter.
 *
 * Runs the project's own `tsc --noEmit` and parses the line-based compiler
 * output into normalized `Diagnostic[]`. We do NOT reimplement the TypeScript
 * compiler — we just wrap its CLI and translate its output.
 *
 * Output format we parse (with `--pretty false`):
 *
 *   src/foo.ts(12,5): error TS2304: Cannot find name 'foo'.
 *   src/bar.ts(3,1): warning TS6133: 'x' is declared but never read.
 *
 * The first capture group is the relative file path, then `(line,col)`,
 * then `error`/`warning`/`info`/`hint`, then `TSxxxx`, then the message.
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

export interface TypescriptAdapterOptions {
  /** Override the path to the TypeScript compiler. If unset, adapter resolves `tsc` from the workspace. */
  tscPath?: string;
  /** Override the tsconfig.json path. If unset, adapter uses `<workspaceRoot>/tsconfig.json`. */
  tsconfigPath?: string;
  /** Hard timeout for the tsc run, in ms. Defaults to 60_000. */
  timeoutMs?: number;
}

export interface TypescriptRunResult {
  diagnostics: Diagnostic[];
  /** Raw tsc stdout (used for debugging the adapter itself). */
  rawStdout: string;
  rawStderr: string;
  durationMs: number;
  exitCode: number | null;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export class TypescriptAdapter {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly options: TypescriptAdapterOptions = {}
  ) {}

  /**
   * Run `tsc --noEmit` for the given workspace root and return normalized diagnostics.
   *
   * The adapter resolves the project's local `node_modules/.bin/tsc` first
   * (so it uses the workspace's TypeScript version, not a global one). If
   * no local tsc is found, it falls back to PATH resolution.
   */
  async run(workspaceRoot: string, signal?: AbortSignal): Promise<TypescriptRunResult> {
    const tsconfigPath = this.options.tsconfigPath ?? path.join(workspaceRoot, "tsconfig.json");
    if (!tsconfigPath) {
      throw new FileNotFoundError(tsconfigPath);
    }

    const tsc = this.options.tscPath ?? (await resolveTscBinary(workspaceRoot));
    if (!tsc) {
      throw new FileNotFoundError(
        "tsc",
        undefined
      );
    }

    const request: CommandRequest = {
      command: tsc,
      args: ["--noEmit", "--pretty", "false", "-p", tsconfigPath],
      cwd: workspaceRoot,
      timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal
    };

    // tsc exits 0 on success, 1 on errors, 2 on config errors. We want to
    // capture exit 1 as "diagnostics present" rather than throw.
    const result = await this.runner.run(request).catch((err) => {
      if (err && typeof err === "object" && "exitCode" in err) {
        // Should not happen — runner doesn't throw on non-zero by default.
        return err as { exitCode: number; stdout: string; stderr: string; durationMs: number };
      }
      throw err;
    });

    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    const exitCode = result.exitCode ?? null;

    const diagnostics = parseTscOutput(stdout, workspaceRoot);

    return {
      diagnostics,
      rawStdout: stdout,
      rawStderr: stderr,
      durationMs: result.durationMs,
      exitCode
    };
  }
}

/**
 * Resolve the TypeScript binary to use for the given workspace.
 *
 * Resolution order:
 *   1. `<root>/node_modules/.bin/tsc`   — projects using npm/pnpm/yarn
 *   2. `<root>/node_modules/typescript/bin/tsc`  — direct path
 *   3. PATH lookup via `resolveExecutable("tsc")`  — global install
 */
async function resolveTscBinary(workspaceRoot: string): Promise<string | undefined> {
  const localBin = path.join(workspaceRoot, "node_modules", ".bin", "tsc");
  try {
    const fs = await import("node:fs/promises");
    await fs.access(localBin);
    return localBin;
  } catch {
    // try next resolution step
  }

  const directPath = path.join(workspaceRoot, "node_modules", "typescript", "bin", "tsc");
  try {
    const fs = await import("node:fs/promises");
    await fs.access(directPath);
    return directPath;
  } catch {
    // fall through to PATH
  }

  return resolveExecutable("tsc");
}

// Regex matches:
//   src/foo.ts(12,5): error TS2304: Cannot find name 'foo'.
//   src/foo.ts(12,5): warning TS6133: 'x' is declared but never read.
const TSC_LINE_REGEX =
  /^(.+?)\((\d+),(\d+)\):\s+(error|warning|info|hint)\s+(TS\d+):\s+(.+)$/;

/**
 * Parse `tsc --pretty false` stdout into normalized diagnostics.
 *
 * Each line is matched independently. Lines that don't match are ignored
 * (they may be blank, or contain summary text like "Found N errors...").
 */
export function parseTscOutput(stdout: string, workspaceRoot: string): Diagnostic[] {
  const lines = stdout.split(/\r?\n/);
  const diagnostics: Diagnostic[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = TSC_LINE_REGEX.exec(line);
    if (!match) continue;

    // match[1] = relative file path, match[2] = line, match[3] = column,
    // match[4] = severity, match[5] = TS code, match[6] = message
    const [, relFile, lineStr, colStr, severityStr, code, message] = match;
    if (!relFile || !lineStr || !colStr || !severityStr || !code || !message) {
      throw new AdapterParseError("typescript", `Matched but missing groups: ${line}`);
    }

    const lineNum = parseInt(lineStr, 10);
    const colNum = parseInt(colStr, 10);
    if (!Number.isFinite(lineNum) || !Number.isFinite(colNum)) {
      throw new AdapterParseError("typescript", `Invalid line/col: ${line}`);
    }

    const severity = mapSeverity(severityStr);
    const absFile = path.resolve(workspaceRoot, relFile);

    diagnostics.push({
      id: `typescript:${code}:${absFile}:${lineNum}:${colNum}`,
      source: "typescript",
      severity,
      message,
      file: absFile,
      range: {
        line: lineNum,
        column: colNum
      },
      code,
      rule: code,
      fixable: false
    });
  }

  return diagnostics;
}

function mapSeverity(s: string): DiagnosticSeverity {
  switch (s) {
    case "error":
      return "error";
    case "warning":
      return "warning";
    case "info":
      return "info";
    case "hint":
      return "hint";
    default:
      return "warning";
  }
}
